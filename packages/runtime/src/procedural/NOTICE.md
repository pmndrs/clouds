# Third-party code and data in the procedural density model (X1)

The procedural model ports code from two MIT-licensed cloud renderers. Their licences require the notices below to stay with the code.

## Sky Pro (DRG Software Solutions LLC)

`density.wgsl.ts` (`PROC_SKYPRO_WGSL`), `textures.ts` (the weather and weather-bounds kernels and the noise-blob loader), the march
and the light taps in `trace.wgsl.ts`, and the defaults in `settings.ts` (`SKYPRO_DEFAULTS`) are ported from Sky Pro
(threejsskypro.com) as it runs in Tidewater (`tidewater/src/sky/SkyProClouds.js`, commit 4811ba4). The compare page loads
Sky Pro's baked noise volume `baseShape64.bin` from `examples/lab/compare/vendor/skypro/clouds/`. Used with the author's permission.

    MIT License
    Copyright (c) 2026 DRG Software Solutions LLC
    Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files
    (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge,
    publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so,
    subject to the following conditions: The above copyright notice and this permission notice shall be included in all copies or
    substantial portions of the Software.
    THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
    MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR
    ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH
    THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

## Takram three-geospatial clouds (@takram/three-clouds 0.7.6)

`density.wgsl.ts` (`PROC_TAKRAM_WGSL`: sampleWeather / sampleMedia), the lighting A/B `procTakramLight` in `trace.wgsl.ts` (marchClouds'
per-sample radiance), and `TAKRAM_DEFAULTS` in `settings.ts` (CloudLayers.DEFAULT, CloudsEffect defaults) are ported from
`node_modules/@takram/three-clouds/src`. The compare page loads its shipped textures `shape.bin`, `shape_detail.bin`,
`local_weather.png` and `turbulence.png` from `node_modules/@takram/three-clouds/assets/` (not copied into this repository).

    MIT License (package.json "license": "MIT"; author Shota Matsuda, Takram; the npm package does not ship its LICENSE file,
    which is in github.com/takram-design-engineering/three-geospatial). The permission notice and disclaimer are the MIT text above.

## Papers

The formulas follow the research notes in `docs/research/` (HZD 2015, Nubis 2017, Nubis Evolved 2022, Frostbite 2016); the comments
in `density.wgsl.ts` and `trace.wgsl.ts` cite the slides.
