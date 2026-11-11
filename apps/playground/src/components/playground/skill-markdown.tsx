"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

const plugins = [remarkGfm];

// Split out so react-markdown and its remark/micromark pipeline load only
// when a skill's instructions are actually viewed rendered.
export default function SkillMarkdown({ children }: { children: string }) {
	return <ReactMarkdown remarkPlugins={plugins}>{children}</ReactMarkdown>;
}
