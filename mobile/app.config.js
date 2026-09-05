const base = require("./app.json").expo;

const origin = process.env.EXPO_PUBLIC_UNIVERSAL_LINK_ORIGIN || "";
let associatedDomains = [];
try {
  const hostname = new URL(origin).hostname;
  if (hostname && !/REPLACE|YOUR_/i.test(hostname)) associatedDomains = [`applinks:${hostname}`];
} catch {
  associatedDomains = [];
}

module.exports = {
  ...base,
  plugins: [...(base.plugins || []), "./plugins/withSpaceSafeXcodeScripts"],
  ios: {
    ...base.ios,
    ...(associatedDomains.length ? { associatedDomains } : {}),
  },
};
