import { useState, useEffect, useRef, useCallback } from 'react';
import { resourcesApi } from '../services/api';
import type { ResourceFile } from '../types';
import {
  Upload,
  Download,
  Trash2,
  FileText,
  FileImage,
  File,
  Search,
  X,
  Pencil,
  Check,
  Eye,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '../contexts/AuthContext';

// ── helpers ────────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / k ** i).toFixed(1))} ${sizes[i]}`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function FileIcon({ mimeType }: { mimeType: string }) {
  if (mimeType.startsWith('image/'))
    return <FileImage className="w-5 h-5 text-primary shrink-0" />;
  if (mimeType === 'application/pdf')
    return <FileText className="w-5 h-5 text-red-400 shrink-0" />;
  return <File className="w-5 h-5 text-text-muted shrink-0" />;
}

function categoryBadgeStyle(category: string): string {
  let hash = 0;
  for (let i = 0; i < category.length; i++) {
    hash = category.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue},55%,38%)`;
}

/** Types that can be previewed directly in the browser */
function isPreviewable(mimeType: string): boolean {
  return (
    mimeType === 'application/pdf' ||
    mimeType.startsWith('image/') ||
    mimeType === 'text/plain' ||
    mimeType === 'text/csv'
  );
}

// ── authenticated fetch helpers ────────────────────────────────────────────

async function fetchFileBlob(fileId: number): Promise<Blob> {
  const token = localStorage.getItem('auth_token');
  const resp = await fetch(resourcesApi.getFileDownloadUrl(fileId), {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!resp.ok) throw new Error('Request failed');
  return resp.blob();
}

// ── component ──────────────────────────────────────────────────────────────

export function ResourceFilesTab() {
  const { user } = useAuth();
  const [files, setFiles] = useState<ResourceFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [search, setSearch] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editMeta, setEditMeta] = useState({ category: '', description: '' });
  const [savingMeta, setSavingMeta] = useState(false);
  const [previewingId, setPreviewingId] = useState<number | null>(null);

  // Preview modal state
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewMime, setPreviewMime] = useState<string>('');
  const [previewName, setPreviewName] = useState<string>('');

  // Upload form state
  const [uploadCategory, setUploadCategory] = useState('');
  const [uploadDescription, setUploadDescription] = useState('');

  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await resourcesApi.getFiles();
      setFiles(res.data.data);
    } catch {
      toast.error('Failed to load files');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Revoke blob URL when preview closes
  useEffect(() => {
    if (!previewUrl) return;
    return () => { URL.revokeObjectURL(previewUrl); };
  }, [previewUrl]);

  // ── upload ──────────────────────────────────────────────────────────────

  const handleUpload = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    setUploading(true);
    let successCount = 0;

    for (const file of Array.from(fileList)) {
      const fd = new FormData();
      fd.append('file', file);
      if (uploadCategory.trim()) fd.append('category', uploadCategory.trim());
      if (uploadDescription.trim()) fd.append('description', uploadDescription.trim());
      try {
        await resourcesApi.uploadFile(fd);
        successCount++;
      } catch (err: any) {
        const msg = err?.response?.data?.error || err?.message || 'Upload failed';
        toast.error(`${file.name}: ${msg}`);
      }
    }

    if (successCount > 0) {
      toast.success(`${successCount} file${successCount > 1 ? 's' : ''} uploaded`);
      setUploadCategory('');
      setUploadDescription('');
      await load();
    }
    setUploading(false);
  };

  const onFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    handleUpload(e.target.files);
    e.target.value = '';
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    handleUpload(e.dataTransfer.files);
  };

  // ── download ─────────────────────────────────────────────────────────────

  const handleDownload = async (file: ResourceFile) => {
    try {
      const blob = await fetchFileBlob(file.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = file.original_name;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error('Download failed');
    }
  };

  // ── preview ───────────────────────────────────────────────────────────────

  const handlePreview = async (file: ResourceFile) => {
    setPreviewingId(file.id);
    try {
      const blob = await fetchFileBlob(file.id);
      // Override MIME for the object URL so browser renders correctly
      const typed = new Blob([blob], { type: file.mime_type });
      const url = URL.createObjectURL(typed);
      setPreviewUrl(url);
      setPreviewMime(file.mime_type);
      setPreviewName(file.original_name);
    } catch {
      toast.error('Preview failed');
    } finally {
      setPreviewingId(null);
    }
  };

  const closePreview = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setPreviewMime('');
    setPreviewName('');
  };

  // ── delete ──────────────────────────────────────────────────────────────

  const handleDelete = async (id: number, name: string) => {
    if (!window.confirm(`Delete "${name}"? This cannot be undone.`)) return;
    setDeletingId(id);
    try {
      await resourcesApi.deleteFile(id);
      toast.success('File deleted');
      setFiles(prev => prev.filter(f => f.id !== id));
    } catch {
      toast.error('Failed to delete file');
    } finally {
      setDeletingId(null);
    }
  };

  // ── edit metadata ───────────────────────────────────────────────────────

  const startEdit = (file: ResourceFile) => {
    setEditingId(file.id);
    setEditMeta({ category: file.category ?? '', description: file.description ?? '' });
  };

  const saveEdit = async (id: number) => {
    setSavingMeta(true);
    try {
      await resourcesApi.updateFileMeta(id, {
        category: editMeta.category || undefined,
        description: editMeta.description || undefined,
      });
      toast.success('Updated');
      setFiles(prev =>
        prev.map(f =>
          f.id === id
            ? { ...f, category: editMeta.category || null, description: editMeta.description || null }
            : f
        )
      );
      setEditingId(null);
    } catch {
      toast.error('Failed to update');
    } finally {
      setSavingMeta(false);
    }
  };

  // ── filter ──────────────────────────────────────────────────────────────

  const filtered = files.filter(f => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      f.original_name.toLowerCase().includes(q) ||
      (f.category ?? '').toLowerCase().includes(q) ||
      (f.description ?? '').toLowerCase().includes(q) ||
      (f.uploaded_by_full_name ?? '').toLowerCase().includes(q)
    );
  });

  // ── render ──────────────────────────────────────────────────────────────

  return (
    <>
    <div className="space-y-6">

      {/* Upload area */}
      <div
        className={`card border-2 border-dashed transition-colors ${
          dragOver ? 'border-primary bg-primary/5' : 'border-border'
        }`}
        onDragOver={e => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
      >
        <div className="flex flex-col items-center gap-3 py-4">
          <Upload className="w-8 h-8 text-text-muted" />
          <p className="text-text-muted text-sm">Drag &amp; drop files here, or</p>
          <button
            className="btn btn-primary"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
          >
            {uploading ? 'Uploading…' : 'Choose Files'}
          </button>
          <p className="text-text-muted text-xs">PDF, Word, Excel, PowerPoint, images, CSV — up to 50 MB each</p>
        </div>

        {/* Optional metadata for the next upload */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-3 border-t border-border mt-2">
          <div>
            <label className="block text-xs text-text-muted mb-1">Category (optional)</label>
            <input
              className="input w-full text-sm"
              placeholder="e.g. Spec Sheet, Pricing"
              value={uploadCategory}
              onChange={e => setUploadCategory(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-xs text-text-muted mb-1">Description (optional)</label>
            <input
              className="input w-full text-sm"
              placeholder="Short note about this file"
              value={uploadDescription}
              onChange={e => setUploadDescription(e.target.value)}
            />
          </div>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={onFileInputChange}
          accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.png,.jpg,.jpeg,.webp,.gif"
        />
      </div>

      {/* Search — fixed: icon doesn't overlap text */}
      {files.length > 0 && (
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted pointer-events-none" />
          <input
            className="input w-full"
            style={{ paddingLeft: '2.25rem' }}
            placeholder="Search files…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          {search && (
            <button
              className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary"
              onClick={() => setSearch('')}
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      )}

      {/* File list */}
      {loading ? (
        <div className="text-text-muted text-sm">Loading files…</div>
      ) : filtered.length === 0 ? (
        <div className="text-text-muted text-sm">
          {search ? 'No files match your search.' : 'No files uploaded yet.'}
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(file => (
            <div key={file.id} className="card flex flex-col gap-2">
              <div className="flex items-start gap-3">
                <FileIcon mimeType={file.mime_type} />

                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-sm truncate">{file.original_name}</span>
                    {file.category && (
                      <span
                        className="px-2 py-0.5 rounded text-xs text-white shrink-0"
                        style={{ background: categoryBadgeStyle(file.category) }}
                      >
                        {file.category}
                      </span>
                    )}
                  </div>

                  {editingId === file.id ? (
                    <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <input
                        className="input text-sm"
                        placeholder="Category"
                        value={editMeta.category}
                        onChange={e => setEditMeta(m => ({ ...m, category: e.target.value }))}
                      />
                      <input
                        className="input text-sm"
                        placeholder="Description"
                        value={editMeta.description}
                        onChange={e => setEditMeta(m => ({ ...m, description: e.target.value }))}
                      />
                    </div>
                  ) : (
                    file.description && (
                      <p className="text-text-muted text-xs mt-0.5">{file.description}</p>
                    )
                  )}

                  <div className="flex flex-wrap gap-3 mt-1 text-xs text-text-muted">
                    <span>{formatBytes(file.size_bytes)}</span>
                    <span>{formatDate(file.created_at)}</span>
                    {file.uploaded_by_full_name && (
                      <span>by {file.uploaded_by_full_name}</span>
                    )}
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1 shrink-0">
                  {editingId === file.id ? (
                    <>
                      <button
                        className="btn btn-primary btn-sm flex items-center gap-1"
                        onClick={() => saveEdit(file.id)}
                        disabled={savingMeta}
                      >
                        <Check className="w-3.5 h-3.5" />
                        Save
                      </button>
                      <button
                        className="btn-secondary btn-sm"
                        onClick={() => setEditingId(null)}
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </>
                  ) : (
                    <>
                      {/* Preview — only for browser-renderable types */}
                      {isPreviewable(file.mime_type) && (
                        <button
                          className="btn-secondary btn-sm flex items-center gap-1"
                          title="Preview"
                          disabled={previewingId === file.id}
                          onClick={() => handlePreview(file)}
                        >
                          <Eye className="w-3.5 h-3.5" />
                        </button>
                      )}

                      <button
                        className="btn-secondary btn-sm flex items-center gap-1"
                        title="Download"
                        onClick={() => handleDownload(file)}
                      >
                        <Download className="w-3.5 h-3.5" />
                      </button>

                      <button
                        className="btn-secondary btn-sm flex items-center gap-1"
                        title="Edit metadata"
                        onClick={() => startEdit(file)}
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>

                      {(user?.role === 'admin' || file.uploaded_by_user_id === user?.id) && (
                        <button
                          className="btn-secondary btn-sm flex items-center gap-1 text-red-400 hover:text-red-300"
                          title="Delete"
                          disabled={deletingId === file.id}
                          onClick={() => handleDelete(file.id, file.original_name)}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>

    {/* Preview modal */}
    {previewUrl && (
      <div
        className="fixed inset-0 z-50 flex flex-col bg-black/80"
        onClick={closePreview}
      >
        {/* Header bar */}
        <div
          className="flex items-center justify-between px-4 py-3 bg-surface-2 shrink-0"
          onClick={e => e.stopPropagation()}
        >
          <span className="text-sm font-medium truncate max-w-[70%]">{previewName}</span>
          <div className="flex items-center gap-2">
            <button
              className="btn-secondary btn-sm flex items-center gap-1"
              onClick={async () => {
                try {
                  const a = document.createElement('a');
                  a.href = previewUrl;
                  a.download = previewName;
                  a.click();
                } catch {
                  toast.error('Download failed');
                }
              }}
            >
              <Download className="w-3.5 h-3.5" />
              Download
            </button>
            <button
              className="btn-secondary btn-sm"
              onClick={closePreview}
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div
          className="flex-1 overflow-auto flex items-center justify-center p-4"
          onClick={e => e.stopPropagation()}
        >
          {previewMime.startsWith('image/') ? (
            <img
              src={previewUrl}
              alt={previewName}
              className="max-w-full max-h-full object-contain rounded"
            />
          ) : previewMime === 'application/pdf' ? (
            <iframe
              src={previewUrl}
              title={previewName}
              className="w-full h-full rounded"
              style={{ minHeight: '80vh' }}
            />
          ) : (
            // text/plain, text/csv
            <TextPreview url={previewUrl} />
          )}
        </div>
      </div>
    )}
    </>
  );
}

// Plain-text preview fetches the blob URL as text
function TextPreview({ url }: { url: string }) {
  const [text, setText] = useState<string | null>(null);

  useEffect(() => {
    fetch(url)
      .then(r => r.text())
      .then(setText)
      .catch(() => setText('Could not load file content.'));
  }, [url]);

  return (
    <pre className="bg-surface-2 text-text-primary text-xs p-4 rounded max-w-4xl w-full overflow-auto whitespace-pre-wrap">
      {text ?? 'Loading…'}
    </pre>
  );
}
