// PPTX parser unit tests. These do not use the operator's worship deck.
// decode/parse/order helpers are tested on hand-built XML; importPptx is
// tested against a tiny zip we write to a temp file at test time.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const AdmZip = require('adm-zip');
const {
	decodeXmlEntities,
	parseSlideText,
	readSlideOrder,
	readRelationships,
	importPptx,
} = require('../server/pptx-import');

describe('decodeXmlEntities', () => {
	const cases = [
		{ name: 'empty', input: { value: '' }, expected: '' },
		{ name: 'amp last', input: { value: 'AT&amp;T' }, expected: 'AT&T' },
		{ name: 'lt/gt', input: { value: '&lt;tag&gt;' }, expected: '<tag>' },
		{
			name: 'does not turn &amp;lt; into <',
			input: { value: '&amp;lt;' },
			expected: '&lt;',
		},
		{ name: 'decimal numeric', input: { value: 'caf&#233;' }, expected: 'café' },
		{ name: 'hex numeric', input: { value: 'caf&#xE9;' }, expected: 'café' },
	];

	for (const { name, input, expected } of cases) {
		it(name, () => {
			const got = decodeXmlEntities({ value: input.value });
			console.log(`decode "${name}":`, JSON.stringify(got));
			assert.equal(got, expected);
		});
	}
});

describe('parseSlideText', () => {
	it('joins a:t runs inside one a:p onto one line', () => {
		const slideXml = '<a:p><a:r><a:t>Hello</a:t></a:r><a:r><a:t> world</a:t></a:r></a:p>';
		const got = parseSlideText({ slideXml });
		console.log('one line:', JSON.stringify(got));
		assert.equal(got, 'Hello world');
	});

	it('treats each a:p as its own line', () => {
		const slideXml =
			'<a:p><a:r><a:t>Line 1</a:t></a:r></a:p><a:p><a:r><a:t>Line 2</a:t></a:r></a:p>';
		const got = parseSlideText({ slideXml });
		console.log('two lines:', JSON.stringify(got));
		assert.equal(got, 'Line 1\nLine 2');
	});

	it('keeps a blank slide as empty string', () => {
		const got = parseSlideText({ slideXml: '<p:sld></p:sld>' });
		console.log('blank slide length:', got.length);
		assert.equal(got, '');
	});
});

describe('readSlideOrder + readRelationships', () => {
	it('reads sldIdLst document order, not filename numbers', () => {
		const presentationXml = `
			<p:presentation>
				<p:sldIdLst>
					<p:sldId id="256" r:id="rId3"/>
					<p:sldId id="257" r:id="rId2"/>
				</p:sldIdLst>
			</p:presentation>`;
		const order = readSlideOrder({ presentationXml });
		console.log('order:', order);
		assert.deepEqual(order, ['rId3', 'rId2']);
	});

	it('maps only relationships whose Type ends in /slide', () => {
		const relsXml = `
			<Relationships>
				<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>
				<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide9.xml"/>
				<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/>
			</Relationships>`;
		const relMap = readRelationships({ relsXml });
		console.log('relMap:', relMap);
		assert.equal(relMap.rId1, undefined);
		assert.equal(relMap.rId3, 'ppt/slides/slide9.xml');
		assert.equal(relMap.rId2, 'ppt/slides/slide1.xml');
	});
});

describe('importPptx', () => {
	it('returns slides in sldIdLst order from a tiny in-memory pptx', async () => {
		const zip = new AdmZip();
		zip.addFile(
			'ppt/presentation.xml',
			Buffer.from(
				'<p:presentation><p:sldIdLst>' +
					'<p:sldId id="1" r:id="rIdB"/>' +
					'<p:sldId id="2" r:id="rIdA"/>' +
					'</p:sldIdLst></p:presentation>'
			)
		);
		zip.addFile(
			'ppt/_rels/presentation.xml.rels',
			Buffer.from(
				'<Relationships>' +
					'<Relationship Id="rIdA" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/>' +
					'<Relationship Id="rIdB" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide2.xml"/>' +
					'</Relationships>'
			)
		);
		zip.addFile('ppt/slides/slide1.xml', Buffer.from('<a:p><a:r><a:t>SECOND</a:t></a:r></a:p>'));
		zip.addFile('ppt/slides/slide2.xml', Buffer.from('<a:p><a:r><a:t>FIRST</a:t></a:r></a:p>'));

		const tmp = path.join(os.tmpdir(), `qs-mini-${Date.now()}.pptx`);
		zip.writeZip(tmp);
		try {
			const { slides } = await importPptx({ filePath: tmp });
			const texts = slides.map((s) => s.text);
			console.log('imported texts in order:', texts);
			console.log(
				'imported ids:',
				slides.map((s) => s.id)
			);
			assert.equal(slides.length, 2, `expected 2 slides, got ${slides.length}`);
			assert.deepEqual(texts, ['FIRST', 'SECOND']);
			assert.notEqual(slides[0].id, slides[1].id);
		} finally {
			fs.unlinkSync(tmp);
		}
	});
});
