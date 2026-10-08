# Disney cloud (converted)

`nvdf.bin`, `sdf.bin` and `cloud.json` here are converted from `wdas_cloud_quarter.vdb`, part of the
Walt Disney Animation Studios Cloud Data Set.

- Copyright 2017 Disney Enterprises, Inc.
- License: Creative Commons Attribution-ShareAlike 3.0 Unported (CC BY-SA 3.0), http://creativecommons.org/licenses/by-sa/3.0/
- The volumetric cloud model was built from a reference photograph by Kevin Udy, Colorado Clouds Blog
  (https://coclouds.com/436/cumulus/2012-07-26/), also CC BY-SA 3.0.
- Source data set: https://www.disneyanimation.com/resources/clouds/

Changes: resampled from 1.46 m source voxels (quarter resolution, world scale 1.75) to 8 m voxels, cropped, and
turned into a profile / detail type / density scale / SDF field by `scripts/vdb/vdb_to_nvdf.py --mode fog --world-scale 1.75
--margin 1 --rotate-y 270`. This converted asset is a derivative work and is distributed under the same license
(CC BY-SA 3.0). The rest of the repository's license does not apply to these files.
