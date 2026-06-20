struct MortonPair {
    code: u32,
    index: u32,
}

struct SortParams {
    count: u32,
    shift: u32,
    pass: u32,
    padding: u32,
}

@group(0) @binding(0) var<storage, read> input: array<MortonPair>;
@group(0) @binding(1) var<storage, read_write> output: array<MortonPair>;
@group(0) @binding(2) var<storage, read_write> histogram: array<u32>;
@group(0) @binding(3) var<uniform> params: SortParams;

var<workgroup> localHistogram: array<u32, 256>;

@compute @workgroup_size(256)
fn compute_histogram(@builtin(global_invocation_id) gid: vec3<u32>, @builtin(local_invocation_id) lid: vec3<u32>) {
    localHistogram[lid.x] = 0u;
    workgroupBarrier();

    let count = params.count;
    let shift = params.shift;
    var idx = gid.x;
    let step = 256u * 64u;

    while (idx < count) {
        let pair = input[idx];
        let bucket = (pair.code >> shift) & 0xFFu;
        localHistogram[bucket]++;
        idx += step;
    }

    workgroupBarrier();

    if (lid.x < 256u) {
        let groupIdx = gid.x / 256u;
        histogram[groupIdx * 256u + lid.x] = localHistogram[lid.x];
    }
}

@compute @workgroup_size(256)
fn prefix_sum(@builtin(global_invocation_id) gid: vec3<u32>, @builtin(local_invocation_id) lid: vec3<u32>) {
    let numGroups = params.count;

    if (lid.x > 0u) {
        return;
    }

    var total: array<u32, 256>;
    for (var b = 0u; b < 256u; b++) {
        total[b] = 0u;
    }

    for (var g = 0u; g < numGroups; g++) {
        for (var b = 0u; b < 256u; b++) {
            let val = histogram[g * 256u + b];
            histogram[g * 256u + b] = total[b];
            total[b] = total[b] + val;
        }
    }
}

@compute @workgroup_size(256)
fn radix_sort(@builtin(global_invocation_id) gid: vec3<u32>, @builtin(local_invocation_id) lid: vec3<u32>) {
    let count = params.count;
    let shift = params.shift;
    let groupIdx = gid.x / 256u;
    let localIdx = gid.x % 256u;

    var idx = gid.x;
    let step = 256u * 64u;

    while (idx < count) {
        let pair = input[idx];
        let bucket = (pair.code >> shift) & 0xFFu;

        var globalOffset = histogram[groupIdx * 256u + bucket];

        var localBucket = 0u;
        for (var g = 0u; g < groupIdx; g++) {
            for (var b = 0u; b < 256u; b++) {
                if (b == bucket) {
                    let h = histogram[g * 256u + b];
                    let nextH = histogram[(g + 1u) * 256u + b];
                    localBucket = localBucket + (nextH - h);
                }
            }
        }

        var writeIdx = globalOffset;
        output[writeIdx] = pair;
        idx += step;
    }
}

@compute @workgroup_size(256)
fn sort_simple(@builtin(global_invocation_id) gid: vec3<u32>) {
    let count = params.count;
    let shift = params.shift;
    let idx = gid.x;

    if (idx >= count) {
        return;
    }

    let pair = input[idx];
    let bucket = (pair.code >> shift) & 0xFFu;

    var position = 0u;
    for (var i = 0u; i < count; i++) {
        let otherCode = input[i].code;
        let otherBucket = (otherCode >> shift) & 0xFFu;
        if (otherBucket < bucket || (otherBucket == bucket && i < idx)) {
            position++;
        }
    }

    output[position] = pair;
}
