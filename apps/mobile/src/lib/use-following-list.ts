import { useRef } from "react";

import type {
	FlatList,
	LayoutChangeEvent,
	NativeScrollEvent,
	NativeSyntheticEvent,
} from "react-native";

export function useFollowingList<Item>(enabled = true) {
	const ref = useRef<FlatList<Item>>(null);
	const followingRef = useRef(true);
	const contentHeightRef = useRef(0);
	const viewportHeightRef = useRef(0);
	const scrollToLatest = () => {
		if (enabled && followingRef.current && viewportHeightRef.current) {
			ref.current?.scrollToOffset({
				offset: Math.max(
					0,
					contentHeightRef.current - viewportHeightRef.current,
				),
				animated: false,
			});
		}
	};
	const updateFollowing = ({
		nativeEvent,
	}: NativeSyntheticEvent<NativeScrollEvent>) => {
		followingRef.current =
			nativeEvent.contentSize.height -
				nativeEvent.layoutMeasurement.height -
				nativeEvent.contentOffset.y <
			80;
	};
	return {
		startFollowing: () => {
			followingRef.current = true;
			scrollToLatest();
		},
		listProps: {
			ref,
			onScrollBeginDrag: () => {
				followingRef.current = false;
			},
			onScrollEndDrag: updateFollowing,
			onMomentumScrollEnd: updateFollowing,
			onLayout: ({ nativeEvent }: LayoutChangeEvent) => {
				viewportHeightRef.current = nativeEvent.layout.height;
				scrollToLatest();
			},
			onContentSizeChange: (_: number, height: number) => {
				contentHeightRef.current = height;
				scrollToLatest();
			},
		},
	};
}
