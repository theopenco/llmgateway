import { pickFile } from "@/lib/files";
import { pickKnowledgeFile } from "@/lib/knowledge-files";

jest.mock("@react-native-documents/picker", () => ({
	types: { allFiles: "public.item" },
}));
jest.mock("@/lib/files", () => ({ pickFile: jest.fn() }));

test.each([
	"notes.md",
	"component.tsx",
	"data.json",
	"table.csv",
	"guide.PDF",
	"workbook.xlsx",
])("accepts supported knowledge files: %s", async (name) => {
	const file = { name, mimeType: "text/plain", base64: "dGV4dA==" };
	jest.mocked(pickFile).mockResolvedValueOnce(file);
	await expect(pickKnowledgeFile()).resolves.toEqual(file);
});

test("rejects unsupported binary files and preserves picker cancellation", async () => {
	jest.mocked(pickFile).mockResolvedValueOnce({
		name: "archive.zip",
		mimeType: "application/zip",
		base64: "YmluYXJ5",
	});
	await expect(pickKnowledgeFile()).rejects.toThrow(
		"Choose a PDF, XLSX, text, or source-code file.",
	);
	jest.mocked(pickFile).mockResolvedValueOnce(null);
	await expect(pickKnowledgeFile()).resolves.toBeNull();
});
