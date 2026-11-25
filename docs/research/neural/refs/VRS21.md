# VRS21 — Scaling local self-attention for parameter efficient visual backbones (HaloNet)

- **Authors / year / venue:** Vaswani, Ramachandran, Srinivas, Parmar, Hechtman, Shlens (Google Research / UC Berkeley); 2021; CVPR 2021 (oral); arXiv 2103.12731
- **Paper:** https://arxiv.org/abs/2103.12731 (local: `artifacts/research/papers/neural/VRS21-vaswani-2021.pdf`, arXiv v3)
- **Project page:** none found
- **Official code:** none found. The paper footnote promises SASA and HaloNet code and checkpoints; timm's author states "there is no official ref impl". (An aravindsrinivas gist is cited in timm for the relative-logits helper.)
- **Third-party code:**
  - https://github.com/lucidrains/halonet-pytorch (Python/PyTorch, MIT, about 200 stars): single-file `HaloAttention(dim, block_size, halo_size, dim_head, heads)`, uses F.unfold for the halo neighbourhoods, factorised relative position embeddings, masks padding.
  - https://github.com/huggingface/pytorch-image-models, `timm/layers/halo_attn.py` (Apache-2.0): `HaloAttn` (block_size default 8, halo_size default 3), `PosEmbedRel`, plus full HaloNet-family models in timm (WIP per author, slow).
  - HaloRT itself ships its own variant: `BlockAttention` and `HaloNetFast` in https://github.com/rendervous/HaloRT/blob/main/halort/_modeling.py (MIT). See below, it differs from the paper.
- **Data / weights:** no official checkpoints found; timm has HaloNet weights for some variants (not verified).
- **Cited by HaloRT as:** the attention block HaloRT uses.

## Summary (halo attention block, precisely)
Goal: make local self-attention as hardware-friendly as convolution. Input feature map H x W x c. Blocked local self-attention: (1) chop the map into non-overlapping b x b query blocks (H/b x W/b blocks). (2) For each block, build a shared neighbourhood by "haloing": extend the block by h pixels on every side (zero padding at image borders) giving a (b+2h) x (b+2h) memory block. (3) Queries come only from the b x b block pixels (W_Q x); keys and values (W_K, W_V) come from the whole (b+2h)^2 neighbourhood. (4) Multi-head dot-product attention per block, run in parallel for all blocks, no attention mask (so each pixel sees a non-centered, block-dependent window; translational equivariance only holds for shifts of b, and they find the unmasked version is slightly more accurate). (5) Relative position: logits = (W_Q x)^T W_K x_ab + (W_Q x)^T r_{a-i,b-j}, with r a learned relative embedding factorised over height and width (half of each head's channels per axis; (2*(b+2h)-1) entries per axis), added to the logits; relative embeddings add very few parameters. Cost scales as HW/b^2 blocks x b^2 queries x (b+2h)^2 keys, i.e. linear in pixels for fixed b,h, versus global attention's quadratic; b=1 recovers per-pixel windows (memory blow-up), b=whole image recovers global attention. Strided attention for downsampling subsamples the queries but keeps the same neighbourhood as stride 1. HaloNet uses b=8, h=3 (14x14 neighbourhood) in many variants; block/halo are kept constant across layers; replaces spatial convs in ResNet bottlenecks, 1x1 convs for projections.

Results: HaloNet H7 reaches 84.9% top-1 on ImageNet; transfers to detection and segmentation; they note global attention becomes preferable in the deepest low-resolution layers.

HaloRT's variant (from its code, not the paper): `BlockAttention(dim, block_size=(8,8), pad_size=(2,2), heads=4, dim_head=32, num_mem_kv=4)`: RMSNorm, reflect-pad the whole map by pad, 1x1 conv to q,k,v, F.unfold into (b+2p) windows with stride b, then queries ALSO cover the whole padded window (not only the central block), 4 learned memory key/value tokens appended per head, no relative position embedding, attend (optionally flash), crop the central b x b, stitch blocks, 1x1 output conv. Used at 8x8 blocks in the U-Net levels and 4x4 at the bottleneck. So to match the released model we port HaloRT's variant, not the exact paper block.

## Use for us
Port plan for WebGPU: one workgroup per block, load the (b+2p)^2 q/k/v tile into shared memory (for 8x8 + pad 2 that is 12x12=144 positions x 4 heads x 32), softmax per query, write the centre 64. Memory KV tokens are just extra rows. Check HaloRT's `_modeling.py` first for exact tensor layouts and norm eps.
