export function segment(bin: Uint8Array, p: number, bitarray: boolean = false): Uint8Array {
    const view = new DataView(bin.buffer);
    let offset = 0;
    for (let i = 0; i < p; i++) {
        offset += ((view.getInt32(offset, true) + 7) >> 3) + 4;
    }
    const length = view.getInt32(offset, true);
    const slice = bin.slice(offset + 4, offset + 4 + ((length + 7) >> 3));
    return bitarray ? Uint8Array.from({ length }, (_, i) => (slice[i >> 3] >> (i % 8)) & 1) : slice;
}

export function hmMakeNode(table: number[][]): { val: number; child: [number, number] }[] {
    const nodes: { val: number; child: [number, number] }[] = [{ val: -1, child: [-1, -1] }];
    for (let i = 0; i < table.length; i++) {
        if (table[i].length === 0) continue;
        let node = nodes[0];
        for (const bit of table[i]) {
            if (node.child[bit] === -1) {
                node.child[bit] = nodes.length;
                node = { val: -1, child: [-1, -1] };
                nodes.push(node);
            } else {
                node = nodes[node.child[bit]];
            }
        }
        node.val = i;
    }
    return nodes;
}

export function hmMakeTableFromLngs(lngs: number[]): number[][] {
    const table: number[][] = Array.from({ length: lngs.length }, () => []);
    const nonZero = lngs.filter(n => n > 0);
    if (nonZero.length === 0) return table;

    const [maxv, minv] = [Math.max(...nonZero), Math.min(...nonZero)];
    const bits = new Array(minv).fill(0);
    let prev = 0;

    for (let s = minv; s <= maxv; s++) {
        for (let i = 0; i < lngs.length; i++) {
            if (lngs[i] !== s) continue;
            if (prev > 0) {
                for (let j = bits.length - 1; j >= 0; j--) {
                    if (bits[j] === 0) {
                        bits[j] = 1;
                        break;
                    }
                    bits[j] = 0;
                }
                bits.push(...new Array(s - prev).fill(0));
            }
            prev = s;
            table[i] = [...bits];
        }
    }
    return table;
}

export function zlDecode(table: number[][], src: Uint8Array, code: number, v0: number, v1: number): number[] {
    const result: number[] = [];

    const nodes = hmMakeNode(table);
    let node = nodes[0];
    for (let i = 0; i < src.length; i++) {
        if ((node = nodes[node.child[src[i]]]).val < 0) continue;

        if (node.val < code){
            result.push(node.val);
        } else if (node.val === code) {
            const search = src.slice(i + 1, i + 1 + v0).map((v, s) => v << s).reduce((a, b) => a + b); i += v0;
            const length = src.slice(i + 1, i + 1 + v1).map((v, s) => v << s).reduce((a, b) => a + b); i += v1;
            for (let j = 0; j < length; j++) {
                result.push(result[result.length - search]);
            }
        }
        node = nodes[0];
    }
    return result;
}


export function table256(): number[][] {
    type NodeType = { cnt: number; parent: NodeType | null };
    const nodes: NodeType[] = [];
    for (let i = 0; i < 256; i++) {
        const sum = [...new Array(7).keys()].map(s => ((i >> s) ^ (i >> (s + 1))) & 1).reduce((a, b) => a + b);
        nodes.push({ cnt: 2 ** (7 - sum), parent: null });
    }
    nodes.push({ cnt: 2 ** 8, parent: null });

    for (let i = 0; i < 256 + 1 - 1; i++) {
        const node: NodeType = { cnt: 0, parent: null };
        for (let j = 0; j < 2; j++) {
            const select = nodes.reduce((a, b) => (a.parent !== null || (b.parent === null && b.cnt < a.cnt)) ? b : a);
            node.cnt += select.cnt;
            select.parent = node;
        }
        nodes.push(node);
    }

    const lngs = new Array(256 + 1).fill(0);
    for (let i = 0; i < 256 + 1; i++) {
        let node: NodeType | null = nodes[i];
        while (node = node.parent) { lngs[i]++; }
    }
    return hmMakeTableFromLngs(lngs);
}
