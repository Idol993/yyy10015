struct PBRMaterialData {
    baseColor: vec4<f32>,
    metallic: f32,
    roughness: f32,
    emissive: vec3<f32>,
    clearcoat: f32,
    clearcoatRoughness: f32,
    transmission: f32,
    ior: f32,
    thickness: f32,
    subsurface: f32,
    alphaCutoff: f32,
    flags: u32,
}

struct BSDFSample {
    f: vec3<f32>,
    pdf: f32,
    wi: vec3<f32>,
    eta: f32,
    sampledType: u32,
}

const BSDF_TYPE_DIFFUSE: u32 = 0x1u;
const BSDF_TYPE_GLOSSY: u32 = 0x2u;
const BSDF_TYPE_SPECULAR: u32 = 0x4u;
const BSDF_TYPE_TRANSMISSION: u32 = 0x8u;
const BSDF_TYPE_ALL: u32 = 0xFu;

struct BSDF {
    ng: vec3<f32>,
    ns: vec3<f32>,
    wo: vec3<f32>,
    material: PBRMaterialData,
    alpha: f32,
}

fn bsdf_init(ng: vec3<f32>, ns: vec3<f32>, wo: vec3<f32>, material: PBRMaterialData) -> BSDF {
    return BSDF(ng, ns, wo, material, max(0.0001, material.roughness * material.roughness));
}

fn f_diffuse_reflectance(albedo: vec3<f32>, metallic: f32) -> vec3<f32> {
    return albedo * (1.0 - metallic);
}

fn f0_from_ior(ior: f32) -> f32 {
    let eta = (ior - 1.0) / (ior + 1.0);
    return eta * eta;
}

fn specular_f0(albedo: vec3<f32>, metallic: f32) -> vec3<f32> {
    return mix(vec3<f32>(f0_from_ior(1.5)), albedo, metallic);
}

fn fr_specular(
    cosThetaI: f32,
    cosThetaO: f32,
    cosThetaH: f32,
    f0: vec3<f32>,
    alpha: f32
) -> vec3<f32> {
    let d = distribution_ggx(vec3<f32>(0.0, 0.0, 1.0), vec3<f32>(0.0, 0.0, cosThetaH), alpha);
    let g = geometry_smith(vec3<f32>(0.0, cosThetaO, 0.0), vec3<f32>(0.0, cosThetaI, 0.0), vec3<f32>(0.0, 0.0, 1.0), alpha);
    let f = fresnel_schlick(cosThetaH, f0);
    
    let denom = 4.0 * abs(cosThetaI) * abs(cosThetaO) + EPSILON;
    return f * d * g / denom;
}

fn fr_lambertian(albedo: vec3<f32>) -> vec3<f32> {
    return albedo * INV_PI;
}

fn evaluate_brdf(bsdf: BSDF, wiLocal: vec3<f32>, woLocal: vec3<f32>) -> vec3<f32> {
    let cosThetaI = wiLocal.z;
    let cosThetaO = woLocal.z;
    
    if (cosThetaI <= 0.0 || cosThetaO <= 0.0) {
        return vec3<f32>(0.0);
    }
    
    let h = normalize(wiLocal + woLocal);
    let cosThetaH = h.z;
    
    let diffuse = f_diffuse_reflectance(bsdf.material.baseColor.rgb, bsdf.material.metallic);
    let f0 = specular_f0(bsdf.material.baseColor.rgb, bsdf.material.metallic);
    
    let fDiffuse = fr_lambertian(diffuse);
    let fSpecular = fr_specular(cosThetaI, cosThetaO, cosThetaH, f0, bsdf.alpha);
    
    var clearcoatFactor = 0.0;
    var fClearcoat = vec3<f32>(0.0);
    
    if (bsdf.material.clearcoat > 0.0) {
        let ccAlpha = max(0.0001, bsdf.material.clearcoatRoughness * bsdf.material.clearcoatRoughness);
        let ccD = distribution_ggx(vec3<f32>(0.0, 0.0, 1.0), h, ccAlpha);
        let ccG = geometry_smith(woLocal, wiLocal, vec3<f32>(0.0, 0.0, 1.0), ccAlpha);
        let ccFresnel = fresnel_dielectric(cosThetaH, 1.0, 1.5);
        let ccDenom = 4.0 * cosThetaI * cosThetaO + EPSILON;
        
        clearcoatFactor = ccFresnel * ccD * ccG / ccDenom;
        fClearcoat = vec3<f32>(bsdf.material.clearcoat * clearcoatFactor);
    }
    
    return fDiffuse + fSpecular + fClearcoat;
}

fn pdf_brdf(bsdf: BSDF, wiLocal: vec3<f32>, woLocal: vec3<f32>) -> f32 {
    let cosThetaI = wiLocal.z;
    let cosThetaO = woLocal.z;
    
    if (cosThetaI <= 0.0 || cosThetaO <= 0.0) {
        return 0.0;
    }
    
    let h = normalize(wiLocal + woLocal);
    let cosThetaH = h.z;
    let dotWH = dot(woLocal, h);
    
    let diffuseWeight = 1.0 - bsdf.material.metallic;
    let specularWeight = bsdf.material.metallic + 0.04 * (1.0 - bsdf.material.metallic);
    let totalWeight = diffuseWeight + specularWeight;
    
    let pdfDiffuse = pdf_cosine_hemisphere(cosThetaI) * (diffuseWeight / totalWeight);
    
    let d = distribution_ggx(vec3<f32>(0.0, 0.0, 1.0), h, bsdf.alpha);
    let pdfSpecular = d * cosThetaH / (4.0 * abs(dotWH) + EPSILON) * (specularWeight / totalWeight);
    
    return pdfDiffuse + pdfSpecular;
}

fn sample_brdf(bsdf: BSDF, woLocal: vec3<f32>, u: vec2<f32>) -> BSDFSample {
    let cosThetaO = woLocal.z;
    
    if (cosThetaO <= 0.0) {
        return BSDFSample(vec3<f32>(0.0), 0.0, vec3<f32>(0.0), 1.0, 0u);
    }
    
    let diffuseWeight = 1.0 - bsdf.material.metallic;
    let specularWeight = bsdf.material.metallic + 0.04 * (1.0 - bsdf.material.metallic);
    let totalWeight = diffuseWeight + specularWeight;
    
    var u2 = u;
    var sampledType: u32;
    var wiLocal: vec3<f32>;
    
    if (u.x < diffuseWeight / totalWeight) {
        u2.x = u.x * totalWeight / diffuseWeight;
        wiLocal = cosine_sample_hemisphere(u2);
        sampledType = BSDF_TYPE_DIFFUSE;
    } else {
        u2.x = (u.x - diffuseWeight / totalWeight) * totalWeight / specularWeight;
        
        let alpha2 = bsdf.alpha * bsdf.alpha;
        let tanTheta2 = alpha2 * u2.x / (1.0 - u2.x);
        let cosTheta = 1.0 / sqrt(1.0 + tanTheta2);
        let sinTheta = sqrt(max(0.0, 1.0 - cosTheta * cosTheta));
        let phi = 2.0 * PI * u2.y;
        
        var h = vec3<f32>(sinTheta * cos(phi), sinTheta * sin(phi), cosTheta);
        h = normalize(h);
        
        wiLocal = normalize(reflect(-woLocal, h));
        sampledType = BSDF_TYPE_SPECULAR;
    }
    
    let cosThetaI = wiLocal.z;
    
    if (cosThetaI <= 0.0) {
        return BSDFSample(vec3<f32>(0.0), 0.0, vec3<f32>(0.0), 1.0, 0u);
    }
    
    let f = evaluate_brdf(bsdf, wiLocal, woLocal);
    let pdf = pdf_brdf(bsdf, wiLocal, woLocal);
    
    return BSDFSample(f, pdf, wiLocal, 1.0, sampledType);
}

fn evaluate_btdf(bsdf: BSDF, wiLocal: vec3<f32>, woLocal: vec3<f32>) -> vec3<f32> {
    if (bsdf.material.transmission <= 0.0) {
        return vec3<f32>(0.0);
    }
    
    let cosThetaO = woLocal.z;
    let cosThetaI = wiLocal.z;
    
    if (cosThetaI >= 0.0 || cosThetaO <= 0.0) {
        return vec3<f32>(0.0);
    }
    
    let eta = select(1.0 / bsdf.material.ior, bsdf.material.ior, cosThetaO < 0.0);
    
    var wt = refract(woLocal, vec3<f32>(0.0, 0.0, 1.0), eta);
    
    if (all(wt == vec3<f32>(0.0))) {
        return vec3<f32>(0.0);
    }
    
    wt = normalize(wt);
    
    let h = normalize(-(woLocal + eta * wt));
    let cosThetaH = h.z;
    let dotHO = dot(h, woLocal);
    let dotHW = dot(h, wt);
    
    let f = fresnel_dielectric(dotHO, 1.0, bsdf.material.ior);
    let t = 1.0 - f;
    
    if (t <= 0.0) {
        return vec3<f32>(0.0);
    }
    
    let d = distribution_ggx(vec3<f32>(0.0, 0.0, 1.0), h, bsdf.alpha);
    let g = geometry_smith(woLocal, wt, vec3<f32>(0.0, 0.0, 1.0), bsdf.alpha);
    
    let denom = (cosThetaO * cosThetaI) * (dotHO * dotHO + dotHW * dotHW * eta * eta) + EPSILON;
    let factor = abs(dotHO * dotHW) * 4.0 * t / denom;
    
    return bsdf.material.baseColor.rgb * bsdf.material.transmission * d * g * factor;
}

fn pdf_btdf(bsdf: BSDF, wiLocal: vec3<f32>, woLocal: vec3<f32>) -> f32 {
    if (bsdf.material.transmission <= 0.0) {
        return 0.0;
    }
    
    let cosThetaO = woLocal.z;
    let cosThetaI = wiLocal.z;
    
    if (cosThetaI >= 0.0 || cosThetaO <= 0.0) {
        return 0.0;
    }
    
    let eta = select(1.0 / bsdf.material.ior, bsdf.material.ior, cosThetaO < 0.0);
    
    var wt = refract(woLocal, vec3<f32>(0.0, 0.0, 1.0), eta);
    
    if (all(wt == vec3<f32>(0.0))) {
        return 0.0;
    }
    
    wt = normalize(wt);
    
    let h = normalize(-(woLocal + eta * wt));
    let cosThetaH = h.z;
    let dotHW = dot(h, wt);
    
    let d = distribution_ggx(vec3<f32>(0.0, 0.0, 1.0), h, bsdf.alpha);
    let denom = dotHO * dotHO + dotHW * dotHW * eta * eta + EPSILON;
    
    return d * cosThetaH * abs(dotHW) * eta * eta / denom;
}

fn sample_btdf(bsdf: BSDF, woLocal: vec3<f32>, u: vec2<f32>) -> BSDFSample {
    if (bsdf.material.transmission <= 0.0) {
        return BSDFSample(vec3<f32>(0.0), 0.0, vec3<f32>(0.0), 1.0, 0u);
    }
    
    let cosThetaO = woLocal.z;
    
    if (cosThetaO <= 0.0) {
        return BSDFSample(vec3<f32>(0.0), 0.0, vec3<f32>(0.0), 1.0, 0u);
    }
    
    let alpha2 = bsdf.alpha * bsdf.alpha;
    let tanTheta2 = alpha2 * u.x / (1.0 - u.x);
    let cosTheta = 1.0 / sqrt(1.0 + tanTheta2);
    let sinTheta = sqrt(max(0.0, 1.0 - cosTheta * cosTheta));
    let phi = 2.0 * PI * u.y;
    
    var h = vec3<f32>(sinTheta * cos(phi), sinTheta * sin(phi), cosTheta);
    h = normalize(h);
    
    let eta = select(1.0 / bsdf.material.ior, bsdf.material.ior, dot(h, woLocal) < 0.0);
    
    let f = fresnel_dielectric(dot(h, woLocal), 1.0, bsdf.material.ior);
    let t = 1.0 - f;
    
    if (t <= 0.0) {
        return BSDFSample(vec3<f32>(0.0), 0.0, vec3<f32>(0.0), 1.0, 0u);
    }
    
    var wi = refract(woLocal, h, eta);
    
    if (all(wi == vec3<f32>(0.0))) {
        return BSDFSample(vec3<f32>(0.0), 0.0, vec3<f32>(0.0), 1.0, 0u);
    }
    
    wi = normalize(wi);
    
    let fVal = evaluate_btdf(bsdf, wi, woLocal);
    let pdf = pdf_btdf(bsdf, wi, woLocal);
    
    return BSDFSample(fVal, pdf, wi, eta, BSDF_TYPE_TRANSMISSION);
}

fn subsurface_scattering(bsdf: BSDF, wo: vec3<f32>, rng: ptr<function, RNG>) -> vec3<f32> {
    if (bsdf.material.subsurface <= 0.0 || bsdf.material.thickness <= 0.0) {
        return vec3<f32>(0.0);
    }
    
    let sigmaT = 1.0 / max(bsdf.material.thickness, 0.001);
    let sigmaS = sigmaT * bsdf.material.subsurface;
    let sigmaA = sigmaT - sigmaS;
    
    var scatteredColor = vec3<f32>(0.0);
    var throughput = bsdf.material.baseColor.rgb;
    
    for (var i = 0u; i < 3u; i++) {
        let d = -log(1.0 - rng_next(rng)) / sigmaT;
        
        if (d > bsdf.material.thickness) {
            break;
        }
        
        let p = rng_next3(rng) - 0.5;
        let phase = rng_next(rng) * 0.5 + 0.5;
        
        scatteredColor = scatteredColor + throughput * sigmaS / sigmaT;
        throughput = throughput * (sigmaS / sigmaT) * phase;
        
        if (is_black(throughput)) {
            break;
        }
    }
    
    return scatteredColor * bsdf.material.subsurface * 0.33;
}

fn evaluate_bsdf(bsdf: BSDF, wi: vec3<f32>, wo: vec3<f32>) -> vec3<f32> {
    if (dot(wi, bsdf.ng) * dot(wo, bsdf.ng) > 0.0) {
        return evaluate_brdf(bsdf, wi, wo);
    } else {
        return evaluate_btdf(bsdf, wi, wo);
    }
}

fn pdf_bsdf(bsdf: BSDF, wi: vec3<f32>, wo: vec3<f32>) -> f32 {
    if (dot(wi, bsdf.ng) * dot(wo, bsdf.ng) > 0.0) {
        return pdf_brdf(bsdf, wi, wo);
    } else {
        return pdf_btdf(bsdf, wi, wo);
    }
}

fn sample_bsdf(bsdf: BSDF, wo: vec3<f32>, u: vec2<f32>, flags: u32) -> BSDFSample {
    let tWeight = bsdf.material.transmission;
    let rWeight = 1.0 - tWeight;
    
    if (u.y < rWeight && (flags & BSDF_TYPE_GLOSSY) != 0u) {
        let u2 = vec2<f32>(u.x, u.y / rWeight);
        return sample_brdf(bsdf, wo, u2);
    } else if ((flags & BSDF_TYPE_TRANSMISSION) != 0u) {
        let u2 = vec2<f32>(u.x, (u.y - rWeight) / max(tWeight, EPSILON));
        return sample_btdf(bsdf, wo, u2);
    } else {
        return sample_brdf(bsdf, wo, u);
    }
}
