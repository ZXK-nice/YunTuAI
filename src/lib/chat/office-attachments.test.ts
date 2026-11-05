import { describe, expect, it } from "vitest";
import { formatOfficeExtractContext, formatOcrResults } from "./office-attachments";

describe("formatOfficeExtractContext", () => {
  it("includes text preview, OCR and image paths", () => {
    const text = formatOfficeExtractContext(
      {
        kind: "pptx",
        slideCount: 3,
        textPreview: "第一页标题",
        imagePaths: ["C:\\tmp\\slide1.jpeg"],
        imageOnly: true,
        ocrPreview: "【OCR 第1张 · slide1.jpeg · tesseract】\n控制台能力",
      },
      "demo.pptx",
    );
    expect(text).toContain("demo.pptx");
    expect(text).toContain("第一页标题");
    expect(text).toContain("slide1.jpeg");
    expect(text).toContain("OCR 预识别");
    expect(text).toContain("控制台能力");
    expect(text).toContain("纯图片幻灯片");
  });

  it("labels PDF pre-extract block", () => {
    const text = formatOfficeExtractContext(
      {
        kind: "pdf",
        slideCount: 5,
        textPreview: "第一章 概述",
        imagePaths: [],
        imageOnly: false,
        ocrPreview: "",
      },
      "spec.pdf",
    );
    expect(text).toContain("PDF 预提取");
    expect(text).toContain("第一章 概述");
  });

  it("labels scanned PDF with OCR block", () => {
    const text = formatOfficeExtractContext(
      {
        kind: "pdf",
        slideCount: 2,
        textPreview: "",
        imagePaths: ["C:\\tmp\\page_001.jpg"],
        imageOnly: true,
        ocrPreview: "【OCR 第1张 · page_001.jpg · tesseract】\n合同正文",
      },
      "scan.pdf",
    );
    expect(text).toContain("scan.pdf");
    expect(text).toContain("扫描件");
    expect(text).toContain("合同正文");
    expect(text).toContain("PDF 页图");
  });
});

describe("formatOcrResults", () => {
  it("formats successful OCR blocks", () => {
    const text = formatOcrResults([
      {
        path: "C:\\a.png",
        name: "a.png",
        text: "标题文字",
        engine: "windows",
        ok: true,
      },
    ]);
    expect(text).toContain("标题文字");
    expect(text).toContain("windows");
  });
});
