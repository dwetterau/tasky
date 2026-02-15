"use client";

import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import { Markdown } from "tiptap-markdown";
import { useEffect, useCallback, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";

/** Get markdown string from the tiptap-markdown storage extension. */
function getMarkdown(editor: Editor): string {
  // tiptap-markdown stores its serializer on editor.storage.markdown
  // but TypeScript doesn't know about it, so we use bracket access.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (editor.storage as Record<string, any>).markdown.getMarkdown();
}

interface MarkdownEditorProps {
  value: string;
  onChange: (markdown: string) => void;
  onSubmit?: () => void;
  placeholder?: string;
  className?: string;
  minHeight?: string;
  autoFocus?: boolean;
}

export function MarkdownEditor({
  value,
  onChange,
  onSubmit,
  placeholder = "",
  className = "",
  minHeight = "200px",
  autoFocus = false,
}: MarkdownEditorProps) {
  const onSubmitRef = useRef(onSubmit);
  onSubmitRef.current = onSubmit;

  const setLinkCallbackRef = useRef<(() => void) | null>(null);

  // Force re-render on selection/cursor changes so toolbar active states stay in sync
  const [, forceUpdate] = useState(0);

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit,
      Link.configure({
        openOnClick: false,
        autolink: true,
        linkOnPaste: true,
        defaultProtocol: "https",
      }),
      Placeholder.configure({
        placeholder,
      }),
      Markdown.configure({
        html: false,
        tightLists: true,
        bulletListMarker: "-",
        transformPastedText: true,
        transformCopiedText: true,
      }),
    ],
    content: value,
    autofocus: autoFocus,
    onUpdate: ({ editor }) => {
      const md = getMarkdown(editor);
      onChange(md);
    },
    onTransaction: () => {
      forceUpdate((n) => n + 1);
    },
    editorProps: {
      attributes: {
        style: `min-height: ${minHeight}`,
      },
      handleKeyDown: (_view, event) => {
        if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
          event.preventDefault();
          onSubmitRef.current?.();
          return true;
        }
        if ((event.metaKey || event.ctrlKey) && event.key === "k") {
          event.preventDefault();
          setLinkCallbackRef.current?.();
          return true;
        }
        return false;
      },
    },
  });

  // Sync external value changes into the editor
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    const currentMd = getMarkdown(editor);
    if (value !== currentMd) {
      editor.commands.setContent(value);
    }
  }, [value, editor]);

  const setLink = useCallback(() => {
    if (!editor) return;
    const previousUrl = editor.getAttributes("link").href;
    const url = window.prompt("URL", previousUrl);
    if (url === null) return;
    if (url === "") {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      return;
    }
    editor
      .chain()
      .focus()
      .extendMarkRange("link")
      .setLink({ href: url })
      .run();
  }, [editor]);

  setLinkCallbackRef.current = setLink;

  if (!editor) {
    // Render a placeholder skeleton that matches the editor layout to avoid shift
    return (
      <div
        className={`border border-(--card-border) rounded-lg overflow-hidden bg-background ${className}`}
      >
        <div className="px-2 py-1.5 border-b border-(--card-border) bg-(--card-bg) h-[34px]" />
        <div style={{ minHeight }} />
      </div>
    );
  }

  return (
    <div
      className={`markdown-editor border border-(--card-border) rounded-lg overflow-hidden focus-within:border-accent transition-colors bg-background ${className}`}
    >
      {/* Toolbar */}
      <div className="flex items-center gap-0.5 px-2 py-1.5 border-b border-(--card-border) bg-(--card-bg) flex-wrap">
        <ToolbarButton
          active={editor.isActive("bold")}
          onClick={() => editor.chain().focus().toggleBold().run()}
          title="Bold (Cmd+B)"
        >
          <IconBold />
        </ToolbarButton>
        <ToolbarButton
          active={editor.isActive("italic")}
          onClick={() => editor.chain().focus().toggleItalic().run()}
          title="Italic (Cmd+I)"
        >
          <IconItalic />
        </ToolbarButton>
        <ToolbarButton
          active={editor.isActive("strike")}
          onClick={() => editor.chain().focus().toggleStrike().run()}
          title="Strikethrough"
        >
          <IconStrikethrough />
        </ToolbarButton>
        <ToolbarButton
          active={editor.isActive("code")}
          onClick={() => editor.chain().focus().toggleCode().run()}
          title="Inline Code (Cmd+E)"
        >
          <IconCode />
        </ToolbarButton>

        <Separator />

        <ToolbarButton
          active={editor.isActive("heading", { level: 2 })}
          onClick={() =>
            editor.chain().focus().toggleHeading({ level: 2 }).run()
          }
          title="Heading 2"
        >
          <IconH2 />
        </ToolbarButton>
        <ToolbarButton
          active={editor.isActive("heading", { level: 3 })}
          onClick={() =>
            editor.chain().focus().toggleHeading({ level: 3 }).run()
          }
          title="Heading 3"
        >
          <IconH3 />
        </ToolbarButton>

        <Separator />

        <ToolbarButton
          active={editor.isActive("bulletList")}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          title="Bullet List"
        >
          <IconBulletList />
        </ToolbarButton>
        <ToolbarButton
          active={editor.isActive("orderedList")}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          title="Numbered List"
        >
          <IconOrderedList />
        </ToolbarButton>

        <Separator />

        <ToolbarButton
          active={editor.isActive("link")}
          onClick={setLink}
          title="Link (Cmd+K)"
        >
          <IconLink />
        </ToolbarButton>
      </div>

      {/* Editor content */}
      <EditorContent editor={editor} />
    </div>
  );
}

function ToolbarButton({
  active,
  onClick,
  children,
  title,
}: {
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
  title: string;
}) {
  return (
    <button
      type="button"
      onMouseDown={(e) => {
        e.preventDefault();
        onClick();
      }}
      className={`p-1.5 rounded transition-colors ${
        active
          ? "bg-(--accent)/20 text-accent"
          : "text-(--muted) hover:text-foreground hover:bg-(--card-border)/50"
      }`}
      title={title}
    >
      {children}
    </button>
  );
}

function Separator() {
  return <div className="w-px h-4 bg-(--card-border) mx-1" />;
}

/* ---- Lucide-style toolbar icons (16×16) ---- */
const iconProps = {
  width: 16,
  height: 16,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

function IconBold() {
  return (
    <svg {...iconProps}>
      <path d="M6 12h9a4 4 0 0 1 0 8H6z" />
      <path d="M6 4h8a4 4 0 0 1 0 8H6z" />
    </svg>
  );
}

function IconItalic() {
  return (
    <svg {...iconProps}>
      <line x1="19" x2="10" y1="4" y2="4" />
      <line x1="14" x2="5" y1="20" y2="20" />
      <line x1="15" x2="9" y1="4" y2="20" />
    </svg>
  );
}

function IconStrikethrough() {
  return (
    <svg {...iconProps}>
      <path d="M16 4H9a3 3 0 0 0-2.83 4" />
      <path d="M14 12a4 4 0 0 1 0 8H6" />
      <line x1="4" x2="20" y1="12" y2="12" />
    </svg>
  );
}

function IconCode() {
  return (
    <svg {...iconProps}>
      <polyline points="16 18 22 12 16 6" />
      <polyline points="8 6 2 12 8 18" />
    </svg>
  );
}

function IconH2() {
  return (
    <svg {...iconProps} strokeWidth={1.75}>
      <path d="M4 12h8" />
      <path d="M4 18V6" />
      <path d="M12 18V6" />
      <path d="M21 18h-4c0-4 4-3 4-6 0-1.5-2-2.5-4-1" />
    </svg>
  );
}

function IconH3() {
  return (
    <svg {...iconProps} strokeWidth={1.75}>
      <path d="M4 12h8" />
      <path d="M4 18V6" />
      <path d="M12 18V6" />
      <path d="M17.5 10.5c1.7-1 3.5 0 3.5 1.5a2 2 0 0 1-2 2" />
      <path d="M17 17.5c2 1.5 4 .3 4-1.5a2 2 0 0 0-2-2" />
    </svg>
  );
}

function IconBulletList() {
  return (
    <svg {...iconProps}>
      <line x1="8" x2="21" y1="6" y2="6" />
      <line x1="8" x2="21" y1="12" y2="12" />
      <line x1="8" x2="21" y1="18" y2="18" />
      <line x1="3" x2="3.01" y1="6" y2="6" />
      <line x1="3" x2="3.01" y1="12" y2="12" />
      <line x1="3" x2="3.01" y1="18" y2="18" />
    </svg>
  );
}

function IconOrderedList() {
  return (
    <svg {...iconProps}>
      <line x1="10" x2="21" y1="6" y2="6" />
      <line x1="10" x2="21" y1="12" y2="12" />
      <line x1="10" x2="21" y1="18" y2="18" />
      <path d="M4 6h1v4" />
      <path d="M4 10h2" />
      <path d="M6 18H4c0-1 2-2 2-3s-1-1.5-2-1" />
    </svg>
  );
}

function IconLink() {
  return (
    <svg {...iconProps}>
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  );
}
