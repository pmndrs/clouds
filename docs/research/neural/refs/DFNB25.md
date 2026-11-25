# DFNB25 — Advancements in biomedical rendering: A survey on AI-based denoising techniques

- **Authors / year / venue:** Elena Denisova, Piergiorgio Francia, Cosimo Nardi, Leonardo Bocchi; Computers in Biology and Medicine 197 (2025), art. 110979, doi 10.1016/j.compbiomed.2025.110979
- **Paper:** open access on the publisher site (Unpaywall: CC-BY-NC-ND) https://www.sciencedirect.com/science/article/pii/S0010482525013319 ; Univ. Florence repository https://flore.unifi.it/handle/2158/1443758 . My direct PDF fetch was blocked (Cloudflare challenge), so no PDF saved (local: not downloaded).
- **Project page:** none found
- **Official code:** none found
- **Third-party code:** none found
- **Data / weights:** none found
- **Cited by HaloRT as:** survey of AI denoising for biomedical volume rendering.

## Summary
Surprise: despite the title, the abstract (via Europe PMC) describes a questionnaire study, not a literature survey: a SurveyMonkey questionnaire of 74 healthcare professionals (radiologists, residents, orthopaedic surgeons, veterinarians) rating AI-denoised vs raw Monte Carlo path-traced CT volume renderings. 77% preferred AI-enhanced images; preference and confidence correlate with experience; participants' preferences did not align perfectly with PSNR/SSIM. Follows the group's "Deep Learning-Based Denoising for Interactive Realistic Rendering of Biomedical Volumes" (Applied Sciences 2025, MDPI 15/18/9893, open access), which is the actual denoising method paper (adapts a MC path-tracing denoiser for CT, domain-specific training). I read only the abstract, not the full text.

## Use for us
Marginal. Only takeaway: human preference diverges from PSNR/SSIM, supporting the owner-eye-over-stats rule. Read the Applied Sciences sibling if we want a biomedical denoiser example.
