<script setup lang="ts">
/**
 * WYSIWYG-Markdown-Editor (TipTap + tiptap-markdown).
 *
 * v-model ist reiner Markdown-Text — gespeichert wird also exakt das Format,
 * das Server und Anzeige (marked/DOMPurify) ohnehin sprechen. Über den
 * Umschalter rechts oben lässt sich jederzeit der Markdown-Quelltext direkt
 * bearbeiten.
 */
import { Editor, EditorContent } from "@tiptap/vue-3";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import Table from "@tiptap/extension-table";
import TableRow from "@tiptap/extension-table-row";
import TableHeader from "@tiptap/extension-table-header";
import TableCell from "@tiptap/extension-table-cell";
import TaskItem from "@tiptap/extension-task-item";
import TaskList from "@tiptap/extension-task-list";
import { Markdown } from "tiptap-markdown";
import {
  PhArrowClockwise,
  PhArrowCounterClockwise,
  PhCode,
  PhCodeBlock,
  PhLinkSimple,
  PhListBullets,
  PhListChecks,
  PhListNumbers,
  PhMarkdownLogo,
  PhMinus,
  PhQuotes,
  PhTable,
  PhTextB,
  PhTextHOne,
  PhTextHThree,
  PhTextHTwo,
  PhTextItalic,
  PhTextStrikethrough,
} from "@phosphor-icons/vue";

const props = withDefaults(
  defineProps<{
    modelValue: string;
    placeholder?: string;
    /** Mindesthöhe des Schreibbereichs, z. B. "12rem". */
    minHeight?: string;
  }>(),
  { placeholder: "Schreiben …", minHeight: "10rem" },
);
const emit = defineEmits<{ (e: "update:modelValue", value: string): void }>();

/** Quelltext-Modus: rohes Markdown in einer Textarea. */
const raw = ref(false);

const editor = new Editor({
  content: props.modelValue,
  extensions: [
    StarterKit.configure({ heading: { levels: [1, 2, 3, 4] } }),
    Link.configure({ openOnClick: false }),
    Placeholder.configure({ placeholder: props.placeholder }),
    Table.configure({ resizable: false }),
    TableRow,
    TableHeader,
    TableCell,
    TaskList,
    TaskItem.configure({ nested: true }),
    Markdown.configure({
      html: false,
      linkify: true,
      transformPastedText: true,
    }),
  ],
  editorProps: {
    attributes: { class: "markdown-body md-editor-content" },
  },
  onUpdate: () => {
    emit("update:modelValue", editor.storage.markdown.getMarkdown());
  },
});

// Externe Änderungen (z. B. Formular-Reset) in den Editor übernehmen —
// aber nicht die eigenen Updates zurückspielen (würde den Cursor werfen).
watch(
  () => props.modelValue,
  (value) => {
    if (!raw.value && value !== editor.storage.markdown.getMarkdown()) {
      editor.commands.setContent(value, false);
    }
  },
);

function toggleRaw(): void {
  if (raw.value) {
    // Quelltext -> Editor: Markdown neu parsen.
    editor.commands.setContent(props.modelValue, false);
  }
  raw.value = !raw.value;
}

function onRawInput(event: Event): void {
  emit("update:modelValue", (event.target as HTMLTextAreaElement).value);
}

function setLink(): void {
  const previous = editor.getAttributes("link").href as string | undefined;
  const url = window.prompt("Link-URL (leer = Link entfernen):", previous ?? "");
  if (url === null) return;
  if (!url) {
    editor.chain().focus().extendMarkRange("link").unsetLink().run();
    return;
  }
  editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
}

function insertTable(): void {
  editor
    .chain()
    .focus()
    .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
    .run();
}

onBeforeUnmount(() => editor.destroy());

interface ToolButton {
  icon: unknown;
  title: string;
  action: () => void;
  isActive?: () => boolean;
}

const buttons: ToolButton[][] = [
  [
    {
      icon: PhTextHOne,
      title: "Überschrift 1",
      action: () => editor.chain().focus().toggleHeading({ level: 1 }).run(),
      isActive: () => editor.isActive("heading", { level: 1 }),
    },
    {
      icon: PhTextHTwo,
      title: "Überschrift 2",
      action: () => editor.chain().focus().toggleHeading({ level: 2 }).run(),
      isActive: () => editor.isActive("heading", { level: 2 }),
    },
    {
      icon: PhTextHThree,
      title: "Überschrift 3",
      action: () => editor.chain().focus().toggleHeading({ level: 3 }).run(),
      isActive: () => editor.isActive("heading", { level: 3 }),
    },
  ],
  [
    {
      icon: PhTextB,
      title: "Fett (Strg+B)",
      action: () => editor.chain().focus().toggleBold().run(),
      isActive: () => editor.isActive("bold"),
    },
    {
      icon: PhTextItalic,
      title: "Kursiv (Strg+I)",
      action: () => editor.chain().focus().toggleItalic().run(),
      isActive: () => editor.isActive("italic"),
    },
    {
      icon: PhTextStrikethrough,
      title: "Durchgestrichen",
      action: () => editor.chain().focus().toggleStrike().run(),
      isActive: () => editor.isActive("strike"),
    },
    {
      icon: PhCode,
      title: "Code (inline)",
      action: () => editor.chain().focus().toggleCode().run(),
      isActive: () => editor.isActive("code"),
    },
    {
      icon: PhLinkSimple,
      title: "Link setzen/entfernen",
      action: setLink,
      isActive: () => editor.isActive("link"),
    },
  ],
  [
    {
      icon: PhListBullets,
      title: "Aufzählung",
      action: () => editor.chain().focus().toggleBulletList().run(),
      isActive: () => editor.isActive("bulletList"),
    },
    {
      icon: PhListNumbers,
      title: "Nummerierte Liste",
      action: () => editor.chain().focus().toggleOrderedList().run(),
      isActive: () => editor.isActive("orderedList"),
    },
    {
      icon: PhListChecks,
      title: "Aufgabenliste",
      action: () => editor.chain().focus().toggleTaskList().run(),
      isActive: () => editor.isActive("taskList"),
    },
  ],
  [
    {
      icon: PhQuotes,
      title: "Zitat",
      action: () => editor.chain().focus().toggleBlockquote().run(),
      isActive: () => editor.isActive("blockquote"),
    },
    {
      icon: PhCodeBlock,
      title: "Code-Block",
      action: () => editor.chain().focus().toggleCodeBlock().run(),
      isActive: () => editor.isActive("codeBlock"),
    },
    { icon: PhTable, title: "Tabelle einfügen", action: insertTable },
    {
      icon: PhMinus,
      title: "Trennlinie",
      action: () => editor.chain().focus().setHorizontalRule().run(),
    },
  ],
  [
    {
      icon: PhArrowCounterClockwise,
      title: "Rückgängig (Strg+Z)",
      action: () => editor.chain().focus().undo().run(),
    },
    {
      icon: PhArrowClockwise,
      title: "Wiederholen (Strg+Umschalt+Z)",
      action: () => editor.chain().focus().redo().run(),
    },
  ],
];
</script>

<template>
  <div class="md-editor" :class="{ raw }">
    <div class="md-toolbar">
      <template v-if="!raw">
        <template v-for="(group, index) in buttons" :key="index">
          <span v-if="index" class="md-toolbar-sep" />
          <button
            v-for="entry in group"
            :key="entry.title"
            type="button"
            class="md-tool"
            :class="{ active: entry.isActive?.() }"
            :title="entry.title"
            @click="entry.action"
          >
            <component :is="entry.icon" :size="16" aria-hidden="true" />
          </button>
        </template>
      </template>
      <span v-else class="muted small" style="padding: 0 0.25rem">
        Markdown-Quelltext
      </span>
      <span class="topbar-spacer" />
      <button
        type="button"
        class="md-tool"
        :class="{ active: raw }"
        title="Markdown-Quelltext bearbeiten"
        @click="toggleRaw"
      >
        <PhMarkdownLogo :size="16" aria-hidden="true" />
      </button>
    </div>
    <textarea
      v-if="raw"
      class="md-raw"
      :value="modelValue"
      :placeholder="placeholder"
      :style="{ minHeight }"
      spellcheck="false"
      @input="onRawInput"
    ></textarea>
    <EditorContent v-else :editor="editor" :style="{ '--md-min-height': minHeight }" />
  </div>
</template>
