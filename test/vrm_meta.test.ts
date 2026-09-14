import fs from 'node:fs';
import { Blob as NodeBlob } from 'node:buffer';
import { parseMOG } from '../src/core/mog3d';
import { DEFAULT_VRM_META, buildVRMMeta, pickVRMMeta } from '../src/core/vrm_meta';

/** jsdom's Blob has no text(), so the node one stands in for it here */
function blob(text: string): Blob {
    return new NodeBlob([text]) as unknown as Blob;
}

describe('pickVRMMeta', () => {
    test('keeps well-formed VRM meta keys', () => {
        expect(pickVRMMeta({
            name: 'ひつじ',
            authors: ['mulsense'],
            avatarPermission: 'everyone',
            allowRedistribution: true,
            otherLicenseUrl: 'https://example.com/license',
        })).toEqual({
            name: 'ひつじ',
            authors: ['mulsense'],
            avatarPermission: 'everyone',
            allowRedistribution: true,
            otherLicenseUrl: 'https://example.com/license',
        });
    });

    test('drops unknown keys, undefined choices, empty strings and non-boolean flags', () => {
        expect(pickVRMMeta({
            thumbnailImage: 0,
            commercialUsage: 'free',
            copyrightInformation: '',
            allowRedistribution: 'yes',
            authors: [],
        })).toEqual({});
        expect(pickVRMMeta(null)).toEqual({});
    });
});

describe('buildVRMMeta', () => {
    test('is the old fixed meta when nothing is given', () => {
        expect(buildVRMMeta()).toEqual(DEFAULT_VRM_META);
        expect(buildVRMMeta().licenseUrl).toBe('https://vrm.dev/licenses/1.0/');
    });

    test('later layers win, and malformed values fall back', () => {
        const meta = buildVRMMeta(
            { commercialUsage: 'corporation', creditNotation: 'unnecessary' },
            { name: 'ひつじ', authors: ['mulsense'], creditNotation: 'bogus' },
        );
        expect(meta.name).toBe('ひつじ');
        expect(meta.authors).toEqual(['mulsense']);
        expect(meta.commercialUsage).toBe('corporation');
        expect(meta.creditNotation).toBe('unnecessary');
        expect(meta.avatarPermission).toBe('onlyAuthor');
    });
});

describe('parseMOG', () => {
    const zundamon = fs.readFileSync('examples/zundamon.mog', 'utf8');

    test('a file without meta carries no meta', async () => {
        const [composit] = await parseMOG(blob(zundamon), null);
        expect(composit.meta).toEqual({});
    });

    test('reads meta from the file, missing keys falling back to the defaults', async () => {
        const json = JSON.parse(zundamon);
        json.meta = { authors: ['東北ずん子'], avatarPermission: 'everyone', allowRedistribution: true, unknown: 1 };

        const [composit] = await parseMOG(blob(JSON.stringify(json)), null);
        expect(composit.meta).toEqual({ authors: ['東北ずん子'], avatarPermission: 'everyone', allowRedistribution: true });
        expect(buildVRMMeta(composit.meta, { name: 'ずんだもん' })).toEqual({
            ...DEFAULT_VRM_META,
            name: 'ずんだもん',
            authors: ['東北ずん子'],
            avatarPermission: 'everyone',
            allowRedistribution: true,
        });
    });

});
