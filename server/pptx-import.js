// pptx-import.js
// -----------------------------------------------------------------------------
// Pure module that turns a PowerPoint .pptx file into an ordered list of
// TEXT-ONLY slides matching this app's deck model:
//
//     { slides: [ { id: "<uuid>", text: "line1\nline2" } ] }
//
// A .pptx file is really a ZIP archive of XML parts (the "Open XML" format).
// We read it entirely in-memory with adm-zip (never extracting to disk) and
// pull the text out of each slide, in the ORDER the presentation defines.
//
// Why ordering is tricky: the slide XML files are named slide1.xml, slide2.xml,
// ... but those numbers are just creation-order ids, NOT presentation order.
// The true running order lives in ppt/presentation.xml under <p:sldIdLst>, which
// lists relationship ids (r:id="rIdN"). Each of those maps, via
// ppt/_rels/presentation.xml.rels, to an actual slide file path. So we must:
//   1. Read the ordered r:id list from presentation.xml.
//   2. Resolve each r:id -> slide file path from the .rels file.
//   3. Read/parse each slide file's text in that resolved order.
// Sorting the slideN.xml files numerically would give the WRONG order.
// -----------------------------------------------------------------------------

const AdmZip = require('adm-zip');
const crypto = require('crypto');

// -----------------------------------------------------------------------------
// XML entity decoding.
// Text inside <a:t> runs is XML-escaped, so "AT&T" is stored as "AT&amp;T".
// We must reverse that so the slide shows real characters.
//
// Order matters: we decode the numeric and the non-ampersand named entities
// FIRST, and decode &amp; -> & LAST. Otherwise a sequence like "&amp;lt;"
// (which literally means the text "&lt;") would wrongly collapse into "<".
// -----------------------------------------------------------------------------
function decodeXmlEntities({ value }) {
	if (!value) return '';
	let out = value;

	// Numeric character references: &#233; (decimal) and &#xE9; (hex).
	out = out.replace(/&#x([0-9a-fA-F]+);/g, (_m, hex) =>
		String.fromCodePoint(parseInt(hex, 16)),
	);
	out = out.replace(/&#(\d+);/g, (_m, dec) => String.fromCodePoint(parseInt(dec, 10)));

	// Named entities (everything except &amp;, handled last).
	out = out
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&apos;/g, "'");

	// Finally the ampersand itself, so we don't double-decode the above.
	out = out.replace(/&amp;/g, '&');

	return out;
}

// -----------------------------------------------------------------------------
// Parse a single slide's XML into one text string.
//
// Structure inside a slide:
//   <a:p> ... paragraph ...           <- ONE visual line
//     <a:r><a:t>some</a:t></a:r>      <- a "run" of text
//     <a:r><a:t> words</a:t></a:r>
//   </a:p>
//
// Rule: each <a:p> is ONE line. Concatenate all <a:t> runs inside it, then join
// paragraphs with "\n". Paragraphs with no runs (empty <a:p/> or bullets with no
// text) contribute an empty line, which we later trim from the ends.
// -----------------------------------------------------------------------------
function parseSlideText({ slideXml }) {
	if (!slideXml) return '';

	const lines = [];

	// Match every paragraph block. Handles both the normal <a:p>...</a:p> form
	// and the self-closing <a:p/> form (an empty paragraph = blank line).
	// [\s\S]*? is a non-greedy "any character including newlines" so we capture
	// exactly one paragraph at a time.
	const paragraphRegex = /<a:p\b[^>]*>([\s\S]*?)<\/a:p>|<a:p\b[^>]*\/>/g;

	let pMatch;
	while ((pMatch = paragraphRegex.exec(slideXml)) !== null) {
		// pMatch[1] is the inner XML of a <a:p>...</a:p>; undefined for <a:p/>.
		const paragraphInner = pMatch[1] || '';

		// Pull every <a:t>...</a:t> run inside this paragraph and concatenate.
		// <a:t> can technically carry attributes (e.g. xml:space="preserve"),
		// so we allow [^>]* before the closing '>'.
		const runRegex = /<a:t\b[^>]*>([\s\S]*?)<\/a:t>/g;
		let line = '';
		let runMatch;
		while ((runMatch = runRegex.exec(paragraphInner)) !== null) {
			line += decodeXmlEntities({ value: runMatch[1] });
		}

		// Trim trailing whitespace per line (leading whitespace can be
		// meaningful indentation, so we leave it alone).
		lines.push(line.replace(/\s+$/, ''));
	}

	// Join paragraphs into the multi-line body, then strip leading/trailing
	// blank lines. Internal blank lines (between two non-empty paragraphs) are
	// preserved because they were intentional spacing in the original slide.
	// A slide with only empty paragraphs collapses to "" here, which is correct:
	// blank slides must still exist to preserve count/order, just with no text.
	const text = lines
		.join('\n')
		.replace(/^\n+/, '')
		.replace(/\s+$/, '');

	return text;
}

// -----------------------------------------------------------------------------
// Read the ordered list of relationship ids from presentation.xml.
// <p:sldIdLst> contains <p:sldId ... r:id="rIdN"/> entries whose DOCUMENT ORDER
// is the presentation order. A global regex over the string preserves that
// order, so the returned array is already correctly sequenced.
// -----------------------------------------------------------------------------
function readSlideOrder({ presentationXml }) {
	const order = [];
	if (!presentationXml) return order;

	// Narrow to just the <p:sldIdLst>...</p:sldIdLst> block so we don't pick up
	// unrelated r:id references elsewhere in the file (e.g. slide masters).
	const listMatch = presentationXml.match(/<p:sldIdLst\b[^>]*>([\s\S]*?)<\/p:sldIdLst>/);
	const listXml = listMatch ? listMatch[1] : presentationXml;

	// Each sldId carries the relationship id in an r:id attribute. Attribute
	// order can vary between authoring tools, so we match r:id specifically
	// rather than assuming its position.
	const sldIdRegex = /<p:sldId\b[^>]*\br:id="([^"]+)"[^>]*\/?>/g;
	let m;
	while ((m = sldIdRegex.exec(listXml)) !== null) {
		order.push(m[1]);
	}
	return order;
}

// -----------------------------------------------------------------------------
// Build a map of relationship id -> slide file path from the .rels file.
// Only relationships whose Type ends in "/slide" are real slides; we ignore
// slideLayout, slideMaster, notesSlide, theme, etc.
//
// The Target is relative to the ppt/ directory (e.g. "slides/slide35.xml"), or
// occasionally absolute (e.g. "/ppt/slides/slide35.xml"). We normalize both to
// the zip entry path "ppt/slides/slideN.xml".
// -----------------------------------------------------------------------------
function readRelationships({ relsXml }) {
	const relMap = {};
	if (!relsXml) return relMap;

	// Match each <Relationship .../> tag, then extract its attributes
	// individually because attribute order is not guaranteed.
	const relRegex = /<Relationship\b[^>]*\/?>/g;
	let tag;
	while ((tag = relRegex.exec(relsXml)) !== null) {
		const tagStr = tag[0];
		const idMatch = tagStr.match(/\bId="([^"]+)"/);
		const typeMatch = tagStr.match(/\bType="([^"]+)"/);
		const targetMatch = tagStr.match(/\bTarget="([^"]+)"/);
		if (!idMatch || !typeMatch || !targetMatch) continue;

		const type = typeMatch[1];
		// Only actual slides. Types look like ".../relationships/slide" for a
		// real slide vs ".../relationships/slideLayout" etc. We require the type
		// to END in "/slide" so "slideLayout"/"slideMaster" are excluded.
		if (!/\/slide$/.test(type)) continue;

		const id = idMatch[1];
		let target = targetMatch[1];

		// Normalize the target into a full zip entry path under ppt/.
		if (target.startsWith('/')) {
			// Absolute within the package, e.g. "/ppt/slides/slide35.xml".
			target = target.replace(/^\/+/, '');
		} else {
			// Relative to ppt/ (the folder that holds presentation.xml).
			target = `ppt/${target}`;
		}

		relMap[id] = target;
	}
	return relMap;
}

// -----------------------------------------------------------------------------
// Small helper: read a zip entry as a UTF-8 string, or null if it's missing.
// Zip entry names always use forward slashes regardless of host OS.
// -----------------------------------------------------------------------------
function readEntryText({ zip, entryName }) {
	const entry = zip.getEntry(entryName);
	if (!entry) return null;
	return zip.readAsText(entry, 'utf8');
}

// -----------------------------------------------------------------------------
// Public API: parse a .pptx into ordered text-only slides.
//
//   const { slides } = await importPptx({ filePath: '/path/to/deck.pptx' });
//
// Every returned slide gets a fresh UUID (crypto.randomUUID) so it plugs
// straight into the app's deck model. Blank slides are kept (text: "") so the
// imported count and ordering exactly mirror the original presentation.
// -----------------------------------------------------------------------------
async function importPptx({ filePath }) {
	if (!filePath) {
		throw new Error('importPptx requires a filePath');
	}

	// Load the whole .pptx (a ZIP) into memory. adm-zip throws if the path is
	// missing or the file isn't a valid archive, which is the behavior we want.
	const zip = new AdmZip(filePath);

	// 1. Ordered relationship ids (the true presentation order).
	const presentationXml = readEntryText({ zip, entryName: 'ppt/presentation.xml' });
	const orderedRelIds = readSlideOrder({ presentationXml });

	// 2. relationship id -> slide file path.
	const relsXml = readEntryText({ zip, entryName: 'ppt/_rels/presentation.xml.rels' });
	const relMap = readRelationships({ relsXml });

	// 3. Walk the ordered ids, resolve to files, parse text. We skip any r:id
	//    that has no slide relationship (defensive; shouldn't normally happen).
	const slides = [];
	for (const relId of orderedRelIds) {
		const slidePath = relMap[relId];
		if (!slidePath) continue;

		const slideXml = readEntryText({ zip, entryName: slidePath });
		// A referenced-but-unreadable slide still counts as a (blank) slide so
		// we never silently change the slide count/ordering.
		const text = slideXml ? parseSlideText({ slideXml }) : '';

		slides.push({ id: crypto.randomUUID(), text });
	}

	return { slides };
}

module.exports = {
	importPptx,
	// Exported for potential unit testing / reuse; not required by callers.
	parseSlideText,
	decodeXmlEntities,
	readSlideOrder,
	readRelationships,
};
