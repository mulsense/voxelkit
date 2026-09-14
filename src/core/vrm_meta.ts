/**
 * VRM 1.0 meta (`extensions.VRMC_vrm.meta`).
 *
 * The keys and values are the ones VRM 1.0 defines, so a `.mog` can carry
 * them as they are under `meta` and they go into the VRM unchanged. The
 * `meta` object and each key in it are optional; what is missing falls back
 * to {@link DEFAULT_VRM_META}.
 * `thumbnailImage` is left out: it points into the glTF's images, which only
 * the converter knows.
 */
export interface VRMMeta {
    name: string;
    version?: string;
    authors: string[];
    copyrightInformation?: string;
    contactInformation?: string;
    references?: string[];
    thirdPartyLicenses?: string;
    licenseUrl: string;
    avatarPermission: 'onlyAuthor' | 'onlySeparatelyLicensedPerson' | 'everyone';
    allowExcessivelyViolentUsage: boolean;
    allowExcessivelySexualUsage: boolean;
    commercialUsage: 'personalNonProfit' | 'personalProfit' | 'corporation';
    allowPoliticalOrReligiousUsage: boolean;
    allowAntisocialOrHateUsage: boolean;
    creditNotation: 'required' | 'unnecessary';
    allowRedistribution?: boolean;
    modification: 'prohibited' | 'allowModification' | 'allowModificationRedistribution';
    otherLicenseUrl?: string;
}

/**
 * What was written before meta could be given, and what a model without any
 * gets: the narrowest terms VRM offers.
 */
export const DEFAULT_VRM_META: VRMMeta = {
    name: 'model',
    version: '1.0',
    authors: ['Author'],
    allowAntisocialOrHateUsage: false,
    allowExcessivelySexualUsage: false,
    allowExcessivelyViolentUsage: false,
    allowPoliticalOrReligiousUsage: false,
    avatarPermission: 'onlyAuthor',
    commercialUsage: 'personalNonProfit',
    creditNotation: 'required',
    modification: 'prohibited',
    licenseUrl: 'https://vrm.dev/licenses/1.0/',
};

const CHOICES = {
    avatarPermission: ['onlyAuthor', 'onlySeparatelyLicensedPerson', 'everyone'],
    commercialUsage: ['personalNonProfit', 'personalProfit', 'corporation'],
    creditNotation: ['required', 'unnecessary'],
    modification: ['prohibited', 'allowModification', 'allowModificationRedistribution'],
} as const;

const TEXTS = ['name', 'version', 'copyrightInformation', 'contactInformation', 'thirdPartyLicenses', 'licenseUrl', 'otherLicenseUrl'] as const;
const LISTS = ['authors', 'references'] as const;
const FLAGS = [
    'allowExcessivelyViolentUsage',
    'allowExcessivelySexualUsage',
    'allowPoliticalOrReligiousUsage',
    'allowAntisocialOrHateUsage',
    'allowRedistribution',
] as const;

/**
 * Keeps only the VRM meta keys whose values have the right shape. Anything
 * else — unknown keys, a choice VRM does not define, an empty string or list,
 * a flag that is not a boolean — is dropped, so it falls back to whatever the
 * meta is merged onto instead of ending up in the file.
 */
export function pickVRMMeta(raw: unknown): Partial<VRMMeta> {
    if (raw === null || typeof raw !== 'object') return {};
    const source = raw as Record<string, unknown>;
    const meta: Record<string, unknown> = {};

    for (const key of TEXTS) {
        const value = source[key];
        if (typeof value === 'string' && value !== '') meta[key] = value;
    }
    for (const key of LISTS) {
        const value = source[key];
        if (Array.isArray(value)) {
            const items = value.filter((item): item is string => typeof item === 'string' && item !== '');
            if (items.length > 0) meta[key] = items;
        }
    }
    for (const key of FLAGS) {
        if (typeof source[key] === 'boolean') meta[key] = source[key];
    }
    for (const [key, choices] of Object.entries(CHOICES)) {
        if ((choices as readonly unknown[]).includes(source[key])) meta[key] = source[key];
    }
    return meta as Partial<VRMMeta>;
}

/**
 * The meta written into a VRM: the defaults, then each given layer over the
 * previous one (typically the `.mog`'s own meta, then what the caller passes).
 */
export function buildVRMMeta(...layers: unknown[]): VRMMeta {
    return layers.reduce<VRMMeta>((meta, layer) => ({ ...meta, ...pickVRMMeta(layer) }), { ...DEFAULT_VRM_META });
}
