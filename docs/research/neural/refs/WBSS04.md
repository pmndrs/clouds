# WBSS04 — Image quality assessment: from error visibility to structural similarity (SSIM)

- **Authors / year / venue:** Zhou Wang, Alan C. Bovik, Hamid R. Sheikh, Eero P. Simoncelli, IEEE Transactions on Image Processing 13(4), pp. 600–612, 2004
- **Paper:** `/Users/dex/Developer/WebGPUClouds/artifacts/research/papers/neural/WBSS04-wang-2004.pdf` (NYU LCV reprint https://www.cns.nyu.edu/pub/lcv/wang03-reprint.pdf, open)
- **Project page:** none
- **Official code:** author MATLAB code not verified; none confirmed
- **Third-party code:** scikit-image `skimage.metrics.structural_similarity`, https://github.com/scikit-image/scikit-image (repo HTTP 200; licence BSD-3 per my recollection, check LICENSE)
- **Data / weights:** none
- **Cited by HaloRT as:** image quality metric

## Summary
SSIM compares local luminance, contrast and structure between two images over Gaussian-weighted windows, and averages the result. It correlates better with perceived quality than plain MSE/PSNR for many distortions, though it is still a per-pixel-structure metric. Computed offline, not in the browser.

## Use for us
Secondary numeric check in A/B comparisons, run as `python3 -I` with scikit-image on captured frames; no JS or WebGPU port found, so it stays off the realtime path. The owner's eye remains the arbiter.
