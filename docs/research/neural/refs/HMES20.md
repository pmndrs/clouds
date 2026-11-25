# HMES20 — Neural Denoising for Path Tracing of Medical Volumetric Data

- **Authors / year / venue:** Nikolai Hofmann, Jörg Martschinke, Klaus Engel, Marc Stamminger; 2020; PACMCGIT 3(2) (HPG 2020), doi 10.1145/3406181
- **Paper:** no open PDF found (ACM paywalled; Unpaywall reports not OA; FAU CRIS and EG diglib pages are metadata only) (local: not downloaded). Abstract read via Crossref.
- **Project page:** https://www.lgdv.tf.fau.de/paper-on-neural-denoising-of-volume-renderings-at-hpg/ (blocked by bot wall when fetched; listed in search results)
- **Official code:** https://github.com/nihofm/ndptmvd — Python/PyTorch, no licence file, pretrained weights included (`models/*.pt`, four configurations); training data NOT published (medical data protection). Verified with `gh api`.
- **Third-party code:** none found
- **Data / weights:** weights yes, datasets no
- **Cited by HaloRT as:** first neural Monte Carlo denoiser for volumes with volume-specific auxiliary features; the "Denoiser" baseline.

## Summary
Problem: path-traced CT/MRI volume videos need many spp; surface-only learned denoisers do not transfer cleanly. Method: a CNN autoencoder (U-Net style, leaky ReLU, 5 encoder/decoder stages, 48 hidden channels, skip connections) denoises a low-spp frame using spatial filtering plus temporal reuse via reprojection of samples. Variants in the repo: single autoencoder, dual autoencoder (direct and indirect branch, the indirect one gets the direct result as input), GAN-trained dual autoencoder, and a dual autoencoder with a learned temporal "feature selector" over reprojected neighbouring frames (N_FRAMES=1 each side). A volume-specific loss is used (paper not read, only abstract and code).

Feature list. I could NOT read the paper; the following is inferred from the released code (`src/data.py`, `src/models.py`) and README, so treat as provisional. Colour (RGB, squared/gamma 2 on load) plus per-pixel guide images stored as 3-channel files: `_pos` (position), `_norm` (normal), `_alb` (albedo), `_vol` (volumetric term), and the same `_norm/_alb/_vol` for a secondary scattering bounce (`1`, `2` suffixes). The direct autoencoder takes 15 channels (5 groups of 3), the indirect one takes colour + direct output + the 9 secondary-bounce channels (24 total input). README states "primary and secondary albedo, normals, positions, volumetric terms". Training tiles 256x256; inference timing not reported in the README.

## Use for us
Reference for what a volume denoiser baseline looks like; its guide set (position, albedo, normal, volume term at primary and secondary scatter) is a menu of candidate network inputs. Weights are medical-CT-trained so unlikely to transfer to clouds; the dual direct/indirect split is the idea worth remembering.
