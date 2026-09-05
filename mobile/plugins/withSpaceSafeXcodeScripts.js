const { withXcodeProject } = require("@expo/config-plugins");

module.exports = function withSpaceSafeXcodeScripts(config) {
  return withXcodeProject(config, (next) => {
    const phases = next.modResults.hash.project.objects.PBXShellScriptBuildPhase || {};
    const unsafe = '`"$NODE_BINARY" --print "require(\'path\').dirname(require.resolve(\'react-native/package.json\')) + \'/scripts/react-native-xcode.sh\'"`';
    const safe = 'REACT_NATIVE_XCODE_SCRIPT="$("$NODE_BINARY" --print "require(\'path\').dirname(require.resolve(\'react-native/package.json\')) + \'/scripts/react-native-xcode.sh\'")"\n"$REACT_NATIVE_XCODE_SCRIPT"';

    for (const phase of Object.values(phases)) {
      if (!phase || typeof phase !== "object" || typeof phase.shellScript !== "string") continue;
      let script;
      try { script = JSON.parse(phase.shellScript); } catch { continue; }
      if (script.includes(unsafe)) phase.shellScript = JSON.stringify(script.replace(unsafe, safe));
    }
    return next;
  });
};
