'use client';

import { type ChangeEvent, useEffect, useRef } from 'react';

export type RichTextImageInput = {
  id: string;
  dataUrl: string;
  filename: string;
  width?: number;
  height?: number;
};

export type RichTextEditorValue = {
  adfJson: string;
  plainText: string;
  images: RichTextImageInput[];
};

type AdfMark = {
  type: string;
  attrs?: Record<string, unknown>;
};

type AdfNode = {
  type: string;
  text?: string;
  attrs?: Record<string, unknown>;
  marks?: AdfMark[];
  content?: AdfNode[];
};

type RichTextEditorProps = {
  resetKey: number;
  onChange: (value: RichTextEditorValue) => void;
  onStatus?: (message: string) => void;
};

const emptyDocument = {
  type: 'doc',
  version: 1,
  content: [{ type: 'paragraph', content: [{ type: 'text', text: ' ' }] }],
};

const maxImageBytes = 5 * 1024 * 1024;

export function RichTextEditor({ resetKey, onChange, onStatus }: RichTextEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const savedRangeRef = useRef<Range | null>(null);

  useEffect(() => {
    if (!editorRef.current) {
      return;
    }

    editorRef.current.innerHTML = '<p><br></p>';
    emitChange();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey]);

  function saveSelection() {
    const editor = editorRef.current;
    const selection = window.getSelection();
    if (!editor || !selection?.rangeCount) {
      return;
    }

    const range = selection.getRangeAt(0);
    if (editor.contains(range.commonAncestorContainer)) {
      savedRangeRef.current = range.cloneRange();
    }
  }

  function restoreSelection() {
    const editor = editorRef.current;
    if (!editor) {
      return;
    }

    editor.focus();
    const selection = window.getSelection();
    if (!selection || !savedRangeRef.current) {
      return;
    }

    selection.removeAllRanges();
    selection.addRange(savedRangeRef.current);
  }

  function runCommand(command: string, value?: string) {
    restoreSelection();
    document.execCommand(command, false, value);
    emitChangeSoon();
  }

  function formatBlock(tagName: string) {
    restoreSelection();
    document.execCommand('formatBlock', false, tagName);
    emitChangeSoon();
  }

  function insertLink() {
    restoreSelection();
    const url = window.prompt('Link URL');
    if (!url) {
      return;
    }

    const selection = window.getSelection();
    if (selection?.isCollapsed) {
      const label = window.prompt('Link text') || url;
      insertHtml(`<a href="${escapeAttribute(url)}">${escapeHtml(label)}</a>`);
      return;
    }

    document.execCommand('createLink', false, url);
    emitChangeSoon();
  }

  function insertTable() {
    const rows = clampNumber(Number(window.prompt('Rows', '3')), 1, 10);
    const columns = clampNumber(Number(window.prompt('Columns', '3')), 1, 8);
    const tableRows = Array.from({ length: rows }, (_, rowIndex) => {
      const cells = Array.from(
        { length: columns },
        (_, columnIndex) => `<td>Cell ${rowIndex + 1}.${columnIndex + 1}</td>`,
      ).join('');
      return `<tr>${cells}</tr>`;
    }).join('');

    insertHtml(`<table><tbody>${tableRows}</tbody></table><p><br></p>`);
  }

  function insertCodeBlock() {
    insertHtml('<pre><code>Code block</code></pre><p><br></p>');
  }

  function insertHtml(html: string) {
    restoreSelection();
    document.execCommand('insertHTML', false, html);
    emitChangeSoon();
  }

  function openImagePicker() {
    saveSelection();
    imageInputRef.current?.click();
  }

  async function handleImageChange(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';

    for (const file of files) {
      if (!file.type.startsWith('image/')) {
        onStatus?.('Choose an image file');
        continue;
      }

      if (file.size > maxImageBytes) {
        onStatus?.('Each rich text image must be 5 MB or smaller');
        continue;
      }

      const dataUrl = await readFileAsDataUrl(file);
      const size = await readImageSize(dataUrl);
      const id = createId();
      const width = size.width || 640;
      const height = size.height || 360;

      insertHtml(
        `<figure><img src="${escapeAttribute(dataUrl)}" alt="${escapeAttribute(
          file.name,
        )}" data-inline-image-id="${id}" data-inline-image-filename="${escapeAttribute(
          file.name,
        )}" data-inline-image-width="${width}" data-inline-image-height="${height}" /><figcaption>${escapeHtml(
          file.name,
        )}</figcaption></figure><p><br></p>`,
      );
    }
  }

  function emitChangeSoon() {
    window.setTimeout(emitChange, 0);
  }

  function emitChange() {
    const editor = editorRef.current;
    if (!editor) {
      onChange({
        adfJson: JSON.stringify(emptyDocument),
        plainText: '',
        images: [],
      });
      return;
    }

    const { document, images } = editorToAdf(editor);
    onChange({
      adfJson: JSON.stringify(document),
      plainText: editor.innerText.trim(),
      images,
    });
  }

  return (
    <div className="rich-editor">
      <div className="rich-toolbar" aria-label="Rich text toolbar">
        <button type="button" title="Paragraph" onClick={() => formatBlock('p')}>
          P
        </button>
        <button type="button" title="Heading 1" onClick={() => formatBlock('h1')}>
          H1
        </button>
        <button type="button" title="Heading 2" onClick={() => formatBlock('h2')}>
          H2
        </button>
        <button type="button" title="Bold" onClick={() => runCommand('bold')}>
          B
        </button>
        <button type="button" title="Italic" onClick={() => runCommand('italic')}>
          I
        </button>
        <button type="button" title="Underline" onClick={() => runCommand('underline')}>
          U
        </button>
        <button type="button" title="Strike" onClick={() => runCommand('strikeThrough')}>
          S
        </button>
        <button type="button" title="Bullet list" onClick={() => runCommand('insertUnorderedList')}>
          List
        </button>
        <button type="button" title="Numbered list" onClick={() => runCommand('insertOrderedList')}>
          1.
        </button>
        <button type="button" title="Quote" onClick={() => formatBlock('blockquote')}>
          Quote
        </button>
        <button type="button" title="Code block" onClick={insertCodeBlock}>
          Code
        </button>
        <button type="button" title="Link" onClick={insertLink}>
          Link
        </button>
        <button type="button" title="Image" onClick={openImagePicker}>
          Image
        </button>
        <button type="button" title="Table" onClick={insertTable}>
          Table
        </button>
      </div>
      <div
        ref={editorRef}
        className="rich-editor-surface"
        contentEditable
        data-placeholder="Write the Jira description..."
        onInput={emitChange}
        onKeyUp={saveSelection}
        onMouseUp={saveSelection}
      />
      <input
        ref={imageInputRef}
        className="hidden-file-input"
        type="file"
        accept="image/*"
        multiple
        onChange={(event) => {
          void handleImageChange(event);
        }}
      />
    </div>
  );
}

function editorToAdf(editor: HTMLElement) {
  const images = new Map<string, RichTextImageInput>();
  const content = Array.from(editor.childNodes).flatMap((node) => blockNodesFromNode(node, images));

  return {
    document: {
      type: 'doc',
      version: 1,
      content: content.length ? content : emptyDocument.content,
    },
    images: Array.from(images.values()),
  };
}

function blockNodesFromNode(
  node: Node,
  images: Map<string, RichTextImageInput>,
): AdfNode[] {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent?.trim();
    return text ? [paragraphNode(inlineNodesFromNode(node, images))] : [];
  }

  if (!(node instanceof HTMLElement)) {
    return [];
  }

  const tagName = node.tagName.toLowerCase();

  if (tagName === 'br') {
    return [];
  }

  if (tagName === 'figure') {
    const image = node.querySelector('img');
    return image ? [imageNodeFromElement(image, images)] : [];
  }

  if (tagName === 'img') {
    return [imageNodeFromElement(node as HTMLImageElement, images)];
  }

  if (/^h[1-6]$/.test(tagName)) {
    return [
      {
        type: 'heading',
        attrs: { level: Math.min(Number(tagName.replace('h', '')), 3) },
        content: inlineNodesFromChildren(node, images),
      },
    ];
  }

  if (tagName === 'ul' || tagName === 'ol') {
    return [listNodeFromElement(node, images, tagName === 'ol')];
  }

  if (tagName === 'blockquote') {
    const quoteContent = Array.from(node.childNodes).flatMap((child) =>
      blockNodesFromNode(child, images),
    );
    return [{ type: 'blockquote', content: quoteContent.length ? quoteContent : [paragraphNode()] }];
  }

  if (tagName === 'pre') {
    return [
      {
        type: 'codeBlock',
        content: [{ type: 'text', text: node.innerText || ' ' }],
      },
    ];
  }

  if (tagName === 'table') {
    return [tableNodeFromElement(node, images)];
  }

  if (hasBlockChildren(node)) {
    return Array.from(node.childNodes).flatMap((child) => blockNodesFromNode(child, images));
  }

  const content = inlineNodesFromChildren(node, images);
  return content.length ? [paragraphNode(content)] : [];
}

function inlineNodesFromChildren(
  element: HTMLElement,
  images: Map<string, RichTextImageInput>,
  marks: AdfMark[] = [],
) {
  return Array.from(element.childNodes).flatMap((child) => inlineNodesFromNode(child, images, marks));
}

function inlineNodesFromNode(
  node: Node,
  images: Map<string, RichTextImageInput>,
  marks: AdfMark[] = [],
): AdfNode[] {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent ?? '';
    return text ? [{ type: 'text', text, ...(marks.length ? { marks } : {}) }] : [];
  }

  if (!(node instanceof HTMLElement)) {
    return [];
  }

  const tagName = node.tagName.toLowerCase();

  if (tagName === 'br') {
    return [{ type: 'hardBreak' }];
  }

  if (tagName === 'img') {
    return [{ type: 'text', text: `[Image: ${node.getAttribute('alt') || 'image'}]` }];
  }

  const nextMarks = marksForElement(node, marks);
  return inlineNodesFromChildren(node, images, nextMarks);
}

function marksForElement(element: HTMLElement, marks: AdfMark[]) {
  const tagName = element.tagName.toLowerCase();
  const nextMarks = [...marks];

  if (tagName === 'b' || tagName === 'strong') {
    nextMarks.push({ type: 'strong' });
  }

  if (tagName === 'i' || tagName === 'em') {
    nextMarks.push({ type: 'em' });
  }

  if (tagName === 'u') {
    nextMarks.push({ type: 'underline' });
  }

  if (tagName === 's' || tagName === 'strike' || tagName === 'del') {
    nextMarks.push({ type: 'strike' });
  }

  if (tagName === 'code') {
    nextMarks.push({ type: 'code' });
  }

  if (tagName === 'a') {
    const href = element.getAttribute('href');
    if (href) {
      nextMarks.push({ type: 'link', attrs: { href } });
    }
  }

  return nextMarks;
}

function listNodeFromElement(
  element: HTMLElement,
  images: Map<string, RichTextImageInput>,
  ordered: boolean,
): AdfNode {
  const items = Array.from(element.children)
    .filter((child) => child.tagName.toLowerCase() === 'li')
    .map((child) => {
      const content = Array.from(child.childNodes).flatMap((node) => {
        if (node instanceof HTMLElement && ['ul', 'ol'].includes(node.tagName.toLowerCase())) {
          return blockNodesFromNode(node, images);
        }

        return [];
      });
      const paragraph = paragraphNode(inlineNodesFromChildren(child as HTMLElement, images));
      return { type: 'listItem', content: [paragraph, ...content] };
    });

  return {
    type: ordered ? 'orderedList' : 'bulletList',
    content: items.length ? items : [{ type: 'listItem', content: [paragraphNode()] }],
  };
}

function tableNodeFromElement(element: HTMLElement, images: Map<string, RichTextImageInput>): AdfNode {
  const rows = Array.from(element.querySelectorAll('tr')).map((row) => ({
    type: 'tableRow',
    content: Array.from(row.children)
      .filter((cell) => ['td', 'th'].includes(cell.tagName.toLowerCase()))
      .map((cell) => ({
        type: cell.tagName.toLowerCase() === 'th' ? 'tableHeader' : 'tableCell',
        attrs: {},
        content: blockNodesFromNode(cell, images).length
          ? blockNodesFromNode(cell, images)
          : [paragraphNode()],
      })),
  }));

  return {
    type: 'table',
    attrs: { isNumberColumnEnabled: false, layout: 'default' },
    content: rows.length ? rows : [{ type: 'tableRow', content: [{ type: 'tableCell', content: [paragraphNode()] }] }],
  };
}

function imageNodeFromElement(
  image: HTMLImageElement,
  images: Map<string, RichTextImageInput>,
): AdfNode {
  const id = image.dataset.inlineImageId || createId();
  const filename = image.dataset.inlineImageFilename || image.alt || 'inline-image.png';
  const width = Number(image.dataset.inlineImageWidth || image.naturalWidth || 640);
  const height = Number(image.dataset.inlineImageHeight || image.naturalHeight || 360);

  if (image.src.startsWith('data:image/')) {
    images.set(id, {
      id,
      dataUrl: image.src,
      filename,
      width,
      height,
    });
  }

  return {
    type: 'mediaSingle',
    attrs: { layout: 'center' },
    content: [
      {
        type: 'media',
        attrs: {
          id,
          type: 'file',
          collection: 'pending-inline-images',
          alt: filename,
          width,
          height,
        },
      },
    ],
  };
}

function paragraphNode(content: AdfNode[] = [{ type: 'text', text: ' ' }]): AdfNode {
  return { type: 'paragraph', content: content.length ? content : [{ type: 'text', text: ' ' }] };
}

function hasBlockChildren(element: HTMLElement) {
  return Array.from(element.children).some((child) =>
    [
      'blockquote',
      'figure',
      'h1',
      'h2',
      'h3',
      'h4',
      'h5',
      'h6',
      'ol',
      'pre',
      'table',
      'ul',
    ].includes(child.tagName.toLowerCase()),
  );
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read image file'));
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.readAsDataURL(file);
  });
}

function readImageSize(dataUrl: string) {
  return new Promise<{ width?: number; height?: number }>((resolve) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => resolve({});
    image.src = dataUrl;
  });
}

function clampNumber(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) {
    return min;
  }

  return Math.min(Math.max(Math.round(value), min), max);
}

function createId() {
  return globalThis.crypto?.randomUUID?.() ?? `image-${Date.now()}-${Math.random()}`;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function escapeAttribute(value: string) {
  return escapeHtml(value).replace(/`/g, '&#096;');
}
