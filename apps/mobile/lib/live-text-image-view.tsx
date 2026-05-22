import {
  Image,
  Platform,
  UIManager,
  type ImageStyle,
  type StyleProp,
  requireNativeComponent,
} from "react-native";

type LiveTextImageViewProps = {
  imageUri: string;
  style?: StyleProp<ImageStyle>;
};

const nativeComponentName = "LiveTextImageView";
const hasNativeLiveTextImageView =
  Platform.OS === "ios" && UIManager.getViewManagerConfig(nativeComponentName) != null;
const NativeLiveTextImageView = hasNativeLiveTextImageView
  ? requireNativeComponent<LiveTextImageViewProps>(nativeComponentName)
  : null;

export function LiveTextImageView({ imageUri, style }: LiveTextImageViewProps) {
  if (NativeLiveTextImageView) {
    return <NativeLiveTextImageView imageUri={imageUri} style={style} />;
  }

  return <Image source={{ uri: imageUri }} style={style} resizeMode="contain" />;
}
