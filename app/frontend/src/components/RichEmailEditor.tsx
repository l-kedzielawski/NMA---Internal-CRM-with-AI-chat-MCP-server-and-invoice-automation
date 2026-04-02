import { useEffect, useRef } from 'react';
import { Bold, Italic, Underline, List, ListOrdered, Heading2, Heading3, Pilcrow, Link, Eraser, Paintbrush } from 'lucide-react';

interface RichEmailEditorProps {
  value: string;
  onChange: (value: string) => void;
  minHeightClass?: string;
}

function isLikelyHtml(value: string): boolean {
  return /<\/?[a-z][\s\S]*>/i.test(value);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function plainTextToHtml(value: string): string {
  const normalized = value.replace(/\r\n/g, '\n').trim();
  if (!normalized) {
    return '';
  }

  return normalized
    .split(/\n{2,}/)
    .map((block) => `<p>${escapeHtml(block).replace(/\n/g, '<br />')}</p>`)
    .join('');
}

export function RichEmailEditor({ value, onChange, minHeightClass = 'min-h-[220px]' }: RichEmailEditorProps) {
  const editorRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!editorRef.current) return;

    const desired = isLikelyHtml(value) ? value : plainTextToHtml(value);
    if (editorRef.current.innerHTML !== desired) {
      editorRef.current.innerHTML = desired;
    }
  }, [value]);

  const execute = (command: string, commandValue?: string) => {
    if (!editorRef.current) return;
    editorRef.current.focus();
    document.execCommand('styleWithCSS', false, 'true');
    document.execCommand(command, false, commandValue);
    onChange(editorRef.current.innerHTML);
  };

  const setColor = (color: string) => {
    execute('foreColor', color);
  };

  const addLink = () => {
    const url = window.prompt('Enter URL (https://...)');
    if (!url) return;
    execute('createLink', url);
  };

  return (
    <div className="border border-border rounded-lg overflow-hidden bg-white">
      <div className="px-2 py-2 border-b border-border bg-gray-50 flex flex-wrap gap-1">
        <button type="button" className="btn-secondary p-2" onClick={() => execute('bold')} title="Bold">
          <Bold className="w-4 h-4" />
        </button>
        <button type="button" className="btn-secondary p-2" onClick={() => execute('italic')} title="Italic">
          <Italic className="w-4 h-4" />
        </button>
        <button type="button" className="btn-secondary p-2" onClick={() => execute('underline')} title="Underline">
          <Underline className="w-4 h-4" />
        </button>
        <button type="button" className="btn-secondary p-2" onClick={() => execute('formatBlock', '<h2>')} title="Heading Large">
          <Heading2 className="w-4 h-4" />
        </button>
        <button type="button" className="btn-secondary p-2" onClick={() => execute('formatBlock', '<h3>')} title="Heading Medium">
          <Heading3 className="w-4 h-4" />
        </button>
        <button type="button" className="btn-secondary p-2" onClick={() => execute('formatBlock', '<p>')} title="Paragraph">
          <Pilcrow className="w-4 h-4" />
        </button>
        <button type="button" className="btn-secondary p-2" onClick={() => execute('insertUnorderedList')} title="Bullet List">
          <List className="w-4 h-4" />
        </button>
        <button type="button" className="btn-secondary p-2" onClick={() => execute('insertOrderedList')} title="Numbered List">
          <ListOrdered className="w-4 h-4" />
        </button>
        <button type="button" className="btn-secondary p-2" onClick={addLink} title="Insert Link">
          <Link className="w-4 h-4" />
        </button>
        <button type="button" className="btn-secondary p-2" onClick={() => setColor('#2f7d3d')} title="Green Text">
          <Paintbrush className="w-4 h-4" />
        </button>
        <button type="button" className="btn-secondary p-2" onClick={() => setColor('#111827')} title="Dark Text">
          <Paintbrush className="w-4 h-4" />
        </button>
        <button type="button" className="btn-secondary p-2" onClick={() => execute('removeFormat')} title="Clear Format">
          <Eraser className="w-4 h-4" />
        </button>
      </div>

      <div
        ref={editorRef}
        contentEditable
        suppressContentEditableWarning
        className={`w-full px-3 py-3 outline-none text-sm text-text ${minHeightClass} [&_h1]:text-2xl [&_h1]:font-bold [&_h1]:text-green-700 [&_h1]:mb-3 [&_h2]:text-xl [&_h2]:font-bold [&_h2]:text-green-700 [&_h2]:mb-3 [&_h3]:text-lg [&_h3]:font-semibold [&_h3]:text-green-700 [&_h3]:mb-2 [&_p]:mb-3 [&_ul]:list-disc [&_ul]:ml-5 [&_ul]:mb-3 [&_ol]:list-decimal [&_ol]:ml-5 [&_ol]:mb-3 [&_li]:mb-1`}
        onInput={(event) => onChange((event.currentTarget as HTMLDivElement).innerHTML)}
      />
    </div>
  );
}
