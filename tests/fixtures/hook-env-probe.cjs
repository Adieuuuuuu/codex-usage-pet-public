"use strict";

process.stdout.write(
  JSON.stringify({
    electronRunAsNode: process.env.ELECTRON_RUN_AS_NODE,
    usagePetHook: process.env.USAGE_PET_HOOK,
    dataDirectory: process.env.USAGE_PET_DATA_DIR,
  }),
);
