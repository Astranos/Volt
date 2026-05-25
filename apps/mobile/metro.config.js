const path = require("path");
const { getDefaultConfig } = require("expo/metro-config");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(workspaceRoot, "node_modules"),
];
config.resolver.extraNodeModules = {
  ...config.resolver.extraNodeModules,
  expo: path.resolve(projectRoot, "node_modules/expo"),
  "expo-router": path.resolve(projectRoot, "node_modules/expo-router"),
  react: path.resolve(projectRoot, "node_modules/react"),
  "react-native": path.resolve(projectRoot, "node_modules/react-native"),
  "react-native-webrtc": path.resolve(projectRoot, "node_modules/react-native-webrtc"),
};

if (process.env.BUILDING_FOR_APP_CLIP) {
  config.resolver.sourceExts = [
    ...config.resolver.sourceExts.map((extension) => `clip.${extension}`),
    ...config.resolver.sourceExts,
  ];
}

module.exports = config;
