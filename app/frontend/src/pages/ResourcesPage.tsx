import { useState, useEffect } from 'react';
import { resourcesApi } from '../services/api';
import type { ResourceTemplate, ResourceCategory, SupportedLanguage, ResourceCreator, ResourceCategoryItem } from '../types';
import { Search, ChevronDown, ChevronRight, Copy, Globe, Edit, Trash2, Check, Plus, X, Save, Tag, Pencil, FolderOpen } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { RichEmailEditor } from '../components/RichEmailEditor';
import { ResourceFilesTab } from '../components/ResourceFilesTab';

interface TemplateFormData {
  title: string;
  category: string;
  content: string;
  tags: string;
}

interface TranslationVersionFormData {
  version_label: string;
  title: string;
  content: string;
}

interface TranslationFormData {
  [key: string]: {
    versions: TranslationVersionFormData[];
  };
}

export function ResourcesPage() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<'templates' | 'files'>('templates');
  const [templates, setTemplates] = useState<ResourceTemplate[]>([]);
  const [categories, setCategories] = useState<ResourceCategoryItem[]>([]);
  const [languages, setLanguages] = useState<SupportedLanguage[]>([]);
  const [creators, setCreators] = useState<ResourceCreator[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [userFilter, setUserFilter] = useState<number | null>(null); // null = all, user.id = my templates, other = specific user
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [selectedLanguage, setSelectedLanguage] = useState<Record<number, string>>({});
  const [selectedVersionKey, setSelectedVersionKey] = useState<Record<string, string>>({});
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [formattedCopiedId, setFormattedCopiedId] = useState<number | null>(null);
  
  // Modal states
  const [showNewModal, setShowNewModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showTranslationsModal, setShowTranslationsModal] = useState(false);
  const [showLanguageModal, setShowLanguageModal] = useState(false);
  const [showCategoryModal, setShowCategoryModal] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<ResourceTemplate | null>(null);
  const [editingCategory, setEditingCategory] = useState<ResourceCategoryItem | null>(null);
  
  // Form states
  const [formData, setFormData] = useState<TemplateFormData>({
    title: '',
    category: '',
    content: '',
    tags: ''
  });
  const [translationData, setTranslationData] = useState<TranslationFormData>({});
  const [newLanguage, setNewLanguage] = useState({ code: '', name: '', native_name: '' });
  const [newCategory, setNewCategory] = useState({ code: '', name: '' });
  const [categoryEditData, setCategoryEditData] = useState({ code: '', name: '' });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadData();
  }, [searchTerm, userFilter]);

  useEffect(() => {
    if (categories.length === 0) {
      return;
    }

    setFormData((previous) => {
      if (previous.category && categories.some((category) => category.code === previous.category)) {
        return previous;
      }

      return {
        ...previous,
        category: categories[0].code,
      };
    });
  }, [categories]);

  const loadData = async () => {
    try {
      setLoading(true);
      const [templatesRes, languagesRes, creatorsRes, categoriesRes] = await Promise.all([
        resourcesApi.getAll({
          search: searchTerm || undefined,
          created_by_user_id: userFilter === null ? undefined : userFilter
        }),
        resourcesApi.getLanguages(),
        resourcesApi.getCreators(),
        resourcesApi.getCategories()
      ]);
      setTemplates(templatesRes.data.data);
      setLanguages(languagesRes.data.data);
      setCreators(creatorsRes.data.data);
      setCategories(categoriesRes.data.data);
    } catch (error) {
      console.error('Error loading resources:', error);
    } finally {
      setLoading(false);
    }
  };

  const getVersionStateKey = (templateId: number, langCode: string) => `${templateId}:${langCode}`;

  const isLikelyHtml = (value: string) => /<\/?[a-z][\s\S]*>/i.test(value);

  const escapeHtml = (value: string) =>
    value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');

  const sanitizeRichHtml = (value: string) =>
    value
      .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '')
      .replace(/\son[a-z]+\s*=\s*"[^"]*"/gi, '')
      .replace(/\son[a-z]+\s*=\s*'[^']*'/gi, '');

  const toPlainTextFromHtml = (value: string) => {
    const temp = document.createElement('div');
    temp.innerHTML = value;
    return temp.textContent?.trim() || '';
  };

  const hasMeaningfulContent = (value: string) => {
    if (!value) return false;
    if (isLikelyHtml(value)) {
      return toPlainTextFromHtml(value).length > 0;
    }
    return value.trim().length > 0;
  };

  const styleRichHtmlForEmail = (rawHtml: string) => {
    const sanitized = sanitizeRichHtml(rawHtml);
    const temp = document.createElement('div');
    temp.innerHTML = sanitized;

    temp.querySelectorAll('h1').forEach((el) => {
      const baseStyle = 'margin:0 0 14px 0;font-size:26px;line-height:1.2;color:#2f7d3d;font-weight:700;';
      el.setAttribute('style', `${baseStyle}${el.getAttribute('style') || ''}`);
    });
    temp.querySelectorAll('h2').forEach((el) => {
      const baseStyle = 'margin:0 0 12px 0;font-size:24px;line-height:1.25;color:#2f7d3d;font-weight:700;';
      el.setAttribute('style', `${baseStyle}${el.getAttribute('style') || ''}`);
    });
    temp.querySelectorAll('h3').forEach((el) => {
      const baseStyle = 'margin:0 0 10px 0;font-size:20px;line-height:1.3;color:#2f7d3d;font-weight:600;';
      el.setAttribute('style', `${baseStyle}${el.getAttribute('style') || ''}`);
    });
    temp.querySelectorAll('p').forEach((el) => {
      const baseStyle = 'margin:0 0 12px 0;';
      el.setAttribute('style', `${baseStyle}${el.getAttribute('style') || ''}`);
    });
    temp.querySelectorAll('ul, ol').forEach((el) => {
      const baseStyle = 'margin:0 0 14px 18px;padding:0;';
      el.setAttribute('style', `${baseStyle}${el.getAttribute('style') || ''}`);
    });
    temp.querySelectorAll('li').forEach((el) => {
      const baseStyle = 'margin:0 0 8px 0;';
      el.setAttribute('style', `${baseStyle}${el.getAttribute('style') || ''}`);
    });
    temp.querySelectorAll('strong').forEach((el) => {
      const baseStyle = 'font-weight:700;';
      el.setAttribute('style', `${baseStyle}${el.getAttribute('style') || ''}`);
    });

    return `
      <div style="font-family:'Segoe UI',Calibri,Arial,sans-serif;font-size:14px;line-height:1.6;color:#1f2937;max-width:760px;">
        ${temp.innerHTML}
      </div>
    `.trim();
  };

  const buildEmailHtml = (title: string, content: string) => {
    const normalized = content.replace(/\r\n/g, '\n').trim();
    const blocks = normalized.length > 0 ? normalized.split(/\n{2,}/) : [];

    const body = blocks
      .map((block) => {
        const lines = block
          .split('\n')
          .map((line) => line.trim())
          .filter((line) => line.length > 0);

        if (lines.length === 0) {
          return '';
        }

        const bulletLines = lines.every((line) => /^(?:[-*•]|✅)\s+/.test(line));
        if (bulletLines) {
          const items = lines
            .map((line) => line.replace(/^(?:[-*•]|✅)\s+/, '').trim())
            .map((line) => `<li style="margin:0 0 8px 0;">${escapeHtml(line)}</li>`)
            .join('');

          return `<ul style="margin:0 0 14px 18px; padding:0;">${items}</ul>`;
        }

        return lines
          .map((line) => `<p style="margin:0 0 12px 0;">${escapeHtml(line)}</p>`)
          .join('');
      })
      .join('');

    const safeTitle = escapeHtml(title);

    return `
      <div style="font-family:'Segoe UI',Calibri,Arial,sans-serif;font-size:14px;line-height:1.6;color:#1f2937;max-width:760px;">
        <p style="margin:0 0 14px 0;font-size:15px;font-weight:600;color:#111827;">${safeTitle}</p>
        ${body}
      </div>
    `.trim();
  };

  const getLanguageVersionOptions = (template: ResourceTemplate, langCode: string) => {
    const translations = template.translations
      .filter((translation) => translation.language_code === langCode)
      .sort((a, b) => (b.version_number || 1) - (a.version_number || 1));

    const options = translations.map((translation) => ({
      key: `v:${translation.version_number || 1}`,
      label: translation.version_label?.trim()
        ? `${translation.version_label.trim()} (v${translation.version_number || 1})`
        : `Version ${translation.version_number || 1}`,
      title: translation.title,
      content: translation.content,
    }));

    if (langCode === 'en') {
      options.push({
        key: 'base',
        label: 'Base Template',
        title: template.title,
        content: template.content,
      });
      return options;
    }

    if (options.length === 0) {
      return [
        {
          key: 'fallback:en',
          label: 'Fallback: English',
          title: template.title,
          content: template.content,
        },
      ];
    }

    return options;
  };

  const getCurrentVersion = (template: ResourceTemplate, templateId: number) => {
    const langCode = selectedLanguage[templateId] || 'en';
    const options = getLanguageVersionOptions(template, langCode);
    const selectedKey = selectedVersionKey[getVersionStateKey(templateId, langCode)];
    return options.find((option) => option.key === selectedKey) || options[0];
  };

  const handleCopy = async (template: ResourceTemplate, templateId: number) => {
    const currentVersion = getCurrentVersion(template, templateId);
    const sourceContent = currentVersion?.content || template.content;
    const textToCopy = isLikelyHtml(sourceContent)
      ? toPlainTextFromHtml(sourceContent)
      : sourceContent;

    try {
      await navigator.clipboard.writeText(textToCopy);
      setCopiedId(templateId);
      setTimeout(() => setCopiedId(null), 2000);
    } catch (error) {
      console.error('Failed to copy:', error);
    }
  };

  const handleCopyFormatted = async (template: ResourceTemplate, templateId: number) => {
    const currentVersion = getCurrentVersion(template, templateId);
    const contentToCopy = currentVersion?.content || template.content;
    const titleToCopy = currentVersion?.title || template.title;
    const htmlToCopy = isLikelyHtml(contentToCopy)
      ? styleRichHtmlForEmail(contentToCopy)
      : buildEmailHtml(titleToCopy, contentToCopy);
    const plainTextToCopy = isLikelyHtml(contentToCopy)
      ? toPlainTextFromHtml(contentToCopy)
      : contentToCopy;

    try {
      if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
        const item = new ClipboardItem({
          'text/html': new Blob([htmlToCopy], { type: 'text/html' }),
          'text/plain': new Blob([plainTextToCopy], { type: 'text/plain' }),
        });
        await navigator.clipboard.write([item]);
      } else {
        await navigator.clipboard.writeText(plainTextToCopy);
      }

      setFormattedCopiedId(templateId);
      setTimeout(() => setFormattedCopiedId(null), 2000);
    } catch (error) {
      console.error('Failed to copy formatted email:', error);
      alert('Failed to copy formatted email. Your browser may not support rich clipboard copy.');
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('Are you sure you want to delete this template?')) return;

    try {
      await resourcesApi.delete(id);
      await loadData();
    } catch (error) {
      console.error('Error deleting template:', error);
    }
  };

  const toggleExpand = (id: number) => {
    setExpandedId(expandedId === id ? null : id);
  };

  const openNewModal = () => {
    setFormData({
      title: '',
      category: categories[0]?.code || '',
      content: '',
      tags: ''
    });
    setShowNewModal(true);
  };

  const openEditModal = (template: ResourceTemplate) => {
    setEditingTemplate(template);
    setFormData({
      title: template.title,
      category: template.category,
      content: template.content,
      tags: template.tags.join(', ')
    });
    setShowEditModal(true);
  };

  const openTranslationsModal = (template: ResourceTemplate) => {
    setEditingTemplate(template);

    // Initialize translation data grouped by language with all versions
    const translations: TranslationFormData = {};
    languages.forEach((lang) => {
      const existing = template.translations
        .filter((translation) => translation.language_code === lang.code)
        .sort((a, b) => (a.version_number || 1) - (b.version_number || 1));

      translations[lang.code] = {
        versions: existing.map((translation) => ({
          version_label: translation.version_label || '',
          title: translation.title || '',
          content: translation.content || ''
        }))
      };
    });
    setTranslationData(translations);
    setShowTranslationsModal(true);
  };

  const addTranslationVersion = (langCode: string) => {
    setTranslationData((current) => {
      const currentVersions = current[langCode]?.versions || [];
      const seedVersion = currentVersions[currentVersions.length - 1] || {
        version_label: '',
        title: editingTemplate?.title || '',
        content: editingTemplate?.content || '',
      };
      return {
        ...current,
        [langCode]: {
          versions: [
            ...currentVersions,
            {
              version_label: seedVersion.version_label,
              title: seedVersion.title,
              content: seedVersion.content,
            },
          ],
        },
      };
    });
  };

  const removeTranslationVersion = (langCode: string, index: number) => {
    setTranslationData((current) => {
      const currentVersions = current[langCode]?.versions || [];
      return {
        ...current,
        [langCode]: {
          versions: currentVersions.filter((_, currentIndex) => currentIndex !== index),
        },
      };
    });
  };

  const updateTranslationVersionField = (
    langCode: string,
    index: number,
    field: 'version_label' | 'title' | 'content',
    value: string
  ) => {
    setTranslationData((current) => {
      const currentVersions = current[langCode]?.versions || [];
      return {
        ...current,
        [langCode]: {
          versions: currentVersions.map((version, currentIndex) => {
            if (currentIndex !== index) {
              return version;
            }

            return {
              ...version,
              [field]: value,
            };
          }),
        },
      };
    });
  };

  const handleCreateTemplate = async () => {
    if (!formData.category) {
      alert('Please create a category first');
      return;
    }

    if (!formData.title || !hasMeaningfulContent(formData.content)) {
      alert('Title and content are required');
      return;
    }

    try {
      setSaving(true);
      const tags = formData.tags
        .split(',')
        .map(t => t.trim())
        .filter(t => t.length > 0);

      await resourcesApi.create({
        title: formData.title,
        category: formData.category,
        content: formData.content,
        tags
      });

      setShowNewModal(false);
      await loadData();
    } catch (error: any) {
      console.error('Error creating template:', error);
      const message = error?.response?.data?.error || 'Failed to create template';
      alert(message);
    } finally {
      setSaving(false);
    }
  };

  const handleUpdateTemplate = async () => {
    if (!formData.category) {
      alert('Please select a category');
      return;
    }

    if (!editingTemplate || !formData.title || !hasMeaningfulContent(formData.content)) {
      alert('Title and content are required');
      return;
    }

    try {
      setSaving(true);
      const tags = formData.tags
        .split(',')
        .map(t => t.trim())
        .filter(t => t.length > 0);

      await resourcesApi.update(editingTemplate.id, {
        title: formData.title,
        category: formData.category,
        content: formData.content,
        tags
      });

      setShowEditModal(false);
      setEditingTemplate(null);
      await loadData();
    } catch (error: any) {
      console.error('Error updating template:', error);
      const message = error?.response?.data?.error || 'Failed to update template';
      alert(message);
    } finally {
      setSaving(false);
    }
  };

  const handleSaveTranslations = async () => {
    if (!editingTemplate) return;

    try {
      setSaving(true);

      const validationErrors: string[] = [];
      const operations: Array<Promise<unknown>> = [];

      for (const lang of languages) {
        const langCode = lang.code;
        const rawVersions = translationData[langCode]?.versions || [];
        const existingRawVersions = editingTemplate.translations
          .filter((translation) => translation.language_code === langCode)
          .sort((a, b) => (a.version_number || 1) - (b.version_number || 1));

        const normalizedVersions = rawVersions
          .map((version) => ({
            version_label: (version.version_label || '').trim() || null,
            title: (version.title || '').trim(),
            content: String(version.content || '').trim(),
            has_content: hasMeaningfulContent(String(version.content || '')),
          }))
          .filter((version) => version.title.length > 0 || version.has_content);

        const hasPartialVersion = normalizedVersions.some(
          (version) => version.title.length === 0 || !version.has_content
        );

        if (hasPartialVersion) {
          const languageLabel = getLanguageName(langCode);
          validationErrors.push(`${languageLabel}: each version must include both title and content.`);
          continue;
        }

        const requestedVersions = normalizedVersions.map((version) => ({
          version_label: version.version_label,
          title: version.title,
          content: version.content,
        }));

        const existingVersions = existingRawVersions
          .map((version) => ({
            version_label: (version.version_label || '').trim() || null,
            title: String(version.title || '').trim(),
            content: String(version.content || '').trim(),
            has_content: hasMeaningfulContent(String(version.content || '')),
          }))
          .filter((version) => version.title.length > 0 || version.has_content)
          .map((version) => ({
            version_label: version.version_label,
            title: version.title,
            content: version.content,
          }));

        if (JSON.stringify(requestedVersions) === JSON.stringify(existingVersions)) {
          continue;
        }

        operations.push(
          resourcesApi.replaceTranslationVersions(
            editingTemplate.id,
            langCode,
            requestedVersions
          )
        );
      }

      if (validationErrors.length > 0) {
        alert(`Cannot save translations:\n\n${validationErrors.join('\n')}`);
        return;
      }

      if (operations.length === 0) {
        alert('No translation changes to save');
        return;
      }

      await Promise.all(operations);

      setShowTranslationsModal(false);
      setEditingTemplate(null);
      await loadData();
    } catch (error: any) {
      console.error('Error saving translations:', error);
      const message = error?.response?.data?.error || 'Failed to save translations';
      alert(message);
    } finally {
      setSaving(false);
    }
  };

  const handleAddLanguage = async () => {
    if (!newLanguage.code || !newLanguage.name || !newLanguage.native_name) {
      alert('All fields are required');
      return;
    }

    // Validate code format (2-5 lowercase letters)
    if (!/^[a-z]{2,3}(?:-[a-z]{2,3})?$/.test(newLanguage.code)) {
      alert('Language code must be lowercase ISO format (e.g., es, pt-br, zh-cn)');
      return;
    }

    try {
      setSaving(true);
      await resourcesApi.addLanguage(newLanguage);
      setNewLanguage({ code: '', name: '', native_name: '' });
      await loadData();
      alert('Language added successfully!');
    } catch (error: any) {
      console.error('Error adding language:', error);
      const message = error?.response?.data?.error || 'Failed to add language';
      alert(message);
    } finally {
      setSaving(false);
    }
  };

  const openEditCategoryModal = (category: ResourceCategoryItem) => {
    setEditingCategory(category);
    setCategoryEditData({ code: category.code, name: category.name });
  };

  const handleAddCategory = async () => {
    if (!newCategory.code || !newCategory.name) {
      alert('Category code and name are required');
      return;
    }

    if (!/^[a-z0-9][a-z0-9_-]{0,49}$/.test(newCategory.code)) {
      alert('Category code must use lowercase letters, numbers, hyphens, or underscores');
      return;
    }

    try {
      setSaving(true);
      await resourcesApi.addCategory({
        code: newCategory.code,
        name: newCategory.name,
      });

      setNewCategory({ code: '', name: '' });
      await loadData();
    } catch (error: any) {
      console.error('Error adding category:', error);
      const message = error?.response?.data?.error || 'Failed to add category';
      alert(message);
    } finally {
      setSaving(false);
    }
  };

  const handleUpdateCategory = async () => {
    if (!editingCategory) {
      return;
    }

    if (!categoryEditData.code || !categoryEditData.name) {
      alert('Category code and name are required');
      return;
    }

    if (!/^[a-z0-9][a-z0-9_-]{0,49}$/.test(categoryEditData.code)) {
      alert('Category code must use lowercase letters, numbers, hyphens, or underscores');
      return;
    }

    try {
      setSaving(true);
      await resourcesApi.updateCategory(editingCategory.code, {
        code: categoryEditData.code,
        name: categoryEditData.name,
      });

      setEditingCategory(null);
      setCategoryEditData({ code: '', name: '' });
      await loadData();
    } catch (error: any) {
      console.error('Error updating category:', error);
      const message = error?.response?.data?.error || 'Failed to update category';
      alert(message);
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteCategory = async (category: ResourceCategoryItem) => {
    const confirmed = confirm(`Delete category "${category.name}"?`);
    if (!confirmed) {
      return;
    }

    try {
      setSaving(true);
      await resourcesApi.deleteCategory(category.code);
      await loadData();
    } catch (error: any) {
      console.error('Error deleting category:', error);
      const message = error?.response?.data?.error || 'Failed to delete category';
      alert(message);
    } finally {
      setSaving(false);
    }
  };

  const getCategoryLabel = (categoryCode: ResourceCategory) => {
    const category = categories.find((entry) => entry.code === categoryCode);
    return category?.name || categoryCode;
  };

  const getCategoryBadgeStyle = (categoryCode: ResourceCategory) => {
    const hash = categoryCode.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    const hue = hash % 360;

    return {
      backgroundColor: `hsla(${hue}, 70%, 50%, 0.2)`,
      color: `hsl(${hue}, 80%, 84%)`,
      border: `1px solid hsla(${hue}, 70%, 60%, 0.5)`,
    };
  };

  const getLanguageName = (code: string) => {
    const lang = languages.find(l => l.code === code);
    return lang ? lang.native_name : code.toUpperCase();
  };

  const getCurrentTitle = (template: ResourceTemplate, templateId: number) => {
    const currentVersion = getCurrentVersion(template, templateId);
    return currentVersion?.title || template.title;
  };

  const getCurrentContent = (template: ResourceTemplate, templateId: number) => {
    const currentVersion = getCurrentVersion(template, templateId);
    return currentVersion?.content || template.content;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-text-muted">Loading resources...</div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <div className="flex items-center gap-4">
          <h2 className="text-2xl font-bold">Sales Resources</h2>
          {/* Main section tabs */}
          <div className="flex gap-1 bg-surface-2 rounded-lg p-1">
            <button
              onClick={() => setActiveTab('templates')}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                activeTab === 'templates'
                  ? 'bg-primary text-white'
                  : 'text-text-muted hover:text-text-primary'
              }`}
            >
              Templates
            </button>
            <button
              onClick={() => setActiveTab('files')}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                activeTab === 'files'
                  ? 'bg-primary text-white'
                  : 'text-text-muted hover:text-text-primary'
              }`}
            >
              <FolderOpen className="w-4 h-4" />
              Files
            </button>
          </div>
        </div>
        {activeTab === 'templates' && (
          <div className="flex gap-2">
            <button onClick={() => setShowCategoryModal(true)} className="btn-secondary flex items-center gap-2">
              <Tag className="w-4 h-4" />
              Manage Categories
            </button>
            <button onClick={() => setShowLanguageModal(true)} className="btn-secondary flex items-center gap-2">
              <Globe className="w-4 h-4" />
              Manage Languages
            </button>
            <button onClick={openNewModal} className="btn-primary flex items-center gap-2">
              <Plus className="w-4 h-4" />
              New Template
            </button>
          </div>
        )}
      </div>

      {/* Files tab content */}
      {activeTab === 'files' && <ResourceFilesTab />}

      {/* Templates tab content */}
      {activeTab === 'templates' && <>

      {/* User Filter Tabs */}
      <div className="card mb-4 flex flex-wrap gap-2 items-center">
        <button
          className={`btn-secondary ${userFilter === null ? 'ring-2 ring-primary' : ''}`}
          onClick={() => setUserFilter(null)}
        >
          All Templates
        </button>
        {user && (
          <button
            className={`btn-secondary ${userFilter === user.id ? 'ring-2 ring-primary' : ''}`}
            onClick={() => setUserFilter(user.id)}
          >
            My Templates
          </button>
        )}
        {creators.filter(c => c.user_id !== user?.id).map(creator => (
          <button
            key={creator.user_id}
            className={`btn-secondary ${userFilter === creator.user_id ? 'ring-2 ring-primary' : ''}`}
            onClick={() => setUserFilter(creator.user_id)}
          >
            {creator.full_name || creator.username} ({creator.template_count})
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="mb-6 relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-text-muted pointer-events-none" />
        <input
          type="text"
          placeholder="Search templates..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-full px-4 py-3 pl-11 border border-border bg-surface-0 text-text rounded-lg focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/30"
        />
      </div>

      {/* Templates List - Accordion */}
      <div className="space-y-3">
        {templates.length === 0 ? (
          <div className="card text-center py-12">
            <p className="text-text-muted">No templates found</p>
            <p className="text-sm text-text-muted mt-1">Try adjusting your search or filters</p>
          </div>
        ) : (
          templates.map((template) => {
            const isExpanded = expandedId === template.id;
            const isCopied = copiedId === template.id;
            const isFormattedCopied = formattedCopiedId === template.id;
            const currentLang = selectedLanguage[template.id] || 'en';
            const availableLanguages = Array.from(new Set(['en', ...template.translations.map((translation) => translation.language_code)]));
            const currentVersionOptions = getLanguageVersionOptions(template, currentLang);
            const versionStateKey = getVersionStateKey(template.id, currentLang);
            const currentVersionKey = selectedVersionKey[versionStateKey] || currentVersionOptions[0]?.key || '';

            return (
              <div key={template.id} className="card overflow-hidden">
                {/* Accordion Header */}
                <div
                  className="flex items-center justify-between p-4 cursor-pointer hover:bg-gray-50 transition-colors"
                  onClick={() => toggleExpand(template.id)}
                >
                  <div className="flex items-center gap-3 flex-1">
                    <div className="text-text-muted">
                      {isExpanded ? (
                        <ChevronDown className="w-5 h-5" />
                      ) : (
                        <ChevronRight className="w-5 h-5" />
                      )}
                    </div>
                    <span className="px-3 py-1 rounded-full text-xs font-medium" style={getCategoryBadgeStyle(template.category)}>
                      {getCategoryLabel(template.category)}
                    </span>
                    <h3 className="font-semibold text-text">
                      {getCurrentTitle(template, template.id)}
                    </h3>
                    {template.tags.length > 0 && (
                      <div className="flex gap-1">
                        {template.tags.slice(0, 3).map((tag, idx) => (
                          <span key={idx} className="px-2 py-0.5 bg-gray-100 text-text-muted text-xs rounded">
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* Accordion Content */}
                {isExpanded && (
                  <div className="border-t border-border">
                    {/* Language Selector */}
                    <div className="px-4 py-3 bg-gray-50 border-b border-border flex items-center gap-2">
                      <Globe className="w-4 h-4 text-text-muted" />
                      <span className="text-sm text-text-muted">Language:</span>
                      <div className="flex gap-2">
                        {availableLanguages.map((lang) => (
                          <button
                            key={lang}
                            onClick={() => setSelectedLanguage({ ...selectedLanguage, [template.id]: lang })}
                            className={`px-3 py-1 text-sm rounded transition-colors ${
                              currentLang === lang
                                ? 'bg-primary text-white'
                                : 'bg-gray-100 text-text-muted hover:bg-gray-200'
                            }`}
                          >
                            {getLanguageName(lang)}
                          </button>
                        ))}
                      </div>
                      <span className="text-sm text-text-muted ml-2">Version:</span>
                      <select
                        className="input max-w-[220px]"
                        value={currentVersionKey}
                        onChange={(event) =>
                          setSelectedVersionKey((current) => ({
                            ...current,
                            [versionStateKey]: event.target.value,
                          }))
                        }
                      >
                        {currentVersionOptions.map((option) => (
                          <option key={`${template.id}-${currentLang}-${option.key}`} value={option.key}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* Content Display */}
                    <div className="p-4">
                      {currentVersionKey && (
                        <div className="mb-2 text-xs text-text-muted">
                          Active version: {currentVersionOptions.find((option) => option.key === currentVersionKey)?.label || 'Latest'}
                        </div>
                      )}
                      <div className="bg-white rounded-lg p-4 border border-border">
                        {isLikelyHtml(getCurrentContent(template, template.id)) ? (
                          <div
                            className="text-sm text-text leading-relaxed [&_h1]:text-2xl [&_h1]:font-bold [&_h1]:text-green-700 [&_h1]:mb-3 [&_h2]:text-xl [&_h2]:font-bold [&_h2]:text-green-700 [&_h2]:mb-3 [&_h3]:text-lg [&_h3]:font-semibold [&_h3]:text-green-700 [&_h3]:mb-2 [&_p]:mb-3 [&_ul]:list-disc [&_ul]:ml-5 [&_ul]:mb-3 [&_ol]:list-decimal [&_ol]:ml-5 [&_ol]:mb-3 [&_li]:mb-1"
                            dangerouslySetInnerHTML={{ __html: sanitizeRichHtml(getCurrentContent(template, template.id)) }}
                          />
                        ) : (
                          <pre className="whitespace-pre-wrap font-sans text-sm text-text leading-relaxed">
                            {getCurrentContent(template, template.id)}
                          </pre>
                        )}
                      </div>
                    </div>

                    {/* Action Buttons */}
                    <div className="px-4 pb-4 flex gap-2">
                      <button
                        onClick={() => handleCopy(template, template.id)}
                        className={`flex items-center gap-2 transition-colors ${
                          isCopied
                            ? 'btn-success'
                            : 'btn-primary'
                        }`}
                      >
                        {isCopied ? (
                          <>
                            <Check className="w-4 h-4" />
                            Copied!
                          </>
                        ) : (
                          <>
                            <Copy className="w-4 h-4" />
                            Copy to Clipboard
                          </>
                        )}
                      </button>
                      <button
                        onClick={() => handleCopyFormatted(template, template.id)}
                        className={`flex items-center gap-2 transition-colors ${
                          isFormattedCopied ? 'btn-success' : 'btn-secondary'
                        }`}
                      >
                        {isFormattedCopied ? (
                          <>
                            <Check className="w-4 h-4" />
                            Formatted copied!
                          </>
                        ) : (
                          <>
                            <Copy className="w-4 h-4" />
                            Copy Formatted Email
                          </>
                        )}
                      </button>
                      <button 
                        onClick={() => openTranslationsModal(template)}
                        className="btn-secondary flex items-center gap-2"
                      >
                        <Globe className="w-4 h-4" />
                        Manage Translations
                      </button>
                      <button 
                        onClick={() => openEditModal(template)}
                        className="btn-secondary flex items-center gap-2"
                      >
                        <Edit className="w-4 h-4" />
                        Edit
                      </button>
                      <button
                        onClick={() => handleDelete(template.id)}
                        className="btn-danger flex items-center gap-2"
                      >
                        <Trash2 className="w-4 h-4" />
                        Delete
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* New Template Modal */}
      {showNewModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="card max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-xl font-bold">Create New Template</h3>
              <button onClick={() => setShowNewModal(false)} className="text-text-muted hover:text-text">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">Title</label>
                <input
                  type="text"
                  value={formData.title}
                  onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                  className="input"
                  placeholder="e.g., Price too high - Budget constraints"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">Category</label>
                {categories.length === 0 ? (
                  <div className="text-sm text-danger">No categories available. Create one in Manage Categories.</div>
                ) : (
                  <select
                    value={formData.category}
                    onChange={(e) => setFormData({ ...formData, category: e.target.value as ResourceCategory })}
                    className="input"
                  >
                    {categories.map((category) => (
                      <option key={category.code} value={category.code}>
                        {category.name}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">Content (English)</label>
                <p className="text-xs text-text-muted mb-2">Supports rich formatting (bold, headings, colors, lists). You can paste directly from Word.</p>
                <RichEmailEditor
                  value={formData.content}
                  onChange={(nextValue) => setFormData({ ...formData, content: nextValue })}
                  minHeightClass="min-h-[260px]"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">Tags (comma-separated)</label>
                <input
                  type="text"
                  value={formData.tags}
                  onChange={(e) => setFormData({ ...formData, tags: e.target.value })}
                  className="input"
                  placeholder="e.g., budget, pricing, enterprise"
                />
              </div>
            </div>

            <div className="flex gap-2 mt-6">
              <button onClick={handleCreateTemplate} disabled={saving || categories.length === 0} className="btn-primary flex items-center gap-2">
                <Save className="w-4 h-4" />
                {saving ? 'Creating...' : 'Create Template'}
              </button>
              <button onClick={() => setShowNewModal(false)} className="btn-secondary">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Template Modal */}
      {showEditModal && editingTemplate && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="card max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-xl font-bold">Edit Template</h3>
              <button onClick={() => setShowEditModal(false)} className="text-text-muted hover:text-text">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">Title</label>
                <input
                  type="text"
                  value={formData.title}
                  onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                  className="input"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">Category</label>
                {categories.length === 0 ? (
                  <div className="text-sm text-danger">No categories available. Create one in Manage Categories.</div>
                ) : (
                  <select
                    value={formData.category}
                    onChange={(e) => setFormData({ ...formData, category: e.target.value as ResourceCategory })}
                    className="input"
                  >
                    {categories.map((category) => (
                      <option key={category.code} value={category.code}>
                        {category.name}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">Content (English)</label>
                <p className="text-xs text-text-muted mb-2">Supports rich formatting (bold, headings, colors, lists). You can paste directly from Word.</p>
                <RichEmailEditor
                  value={formData.content}
                  onChange={(nextValue) => setFormData({ ...formData, content: nextValue })}
                  minHeightClass="min-h-[260px]"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">Tags (comma-separated)</label>
                <input
                  type="text"
                  value={formData.tags}
                  onChange={(e) => setFormData({ ...formData, tags: e.target.value })}
                  className="input"
                />
              </div>
            </div>

            <div className="flex gap-2 mt-6">
              <button onClick={handleUpdateTemplate} disabled={saving} className="btn-primary flex items-center gap-2">
                <Save className="w-4 h-4" />
                {saving ? 'Saving...' : 'Save Changes'}
              </button>
              <button onClick={() => setShowEditModal(false)} className="btn-secondary">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Manage Translations Modal */}
      {showTranslationsModal && editingTemplate && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="card max-w-4xl w-full max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-xl font-bold">Manage Translations: {editingTemplate.title}</h3>
              <button onClick={() => setShowTranslationsModal(false)} className="text-text-muted hover:text-text">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-6">
              <div className="border border-border rounded-lg p-3 bg-gray-50">
                <p className="text-sm text-text-muted">
                  You can keep multiple versions per language. For English, "Base Template" remains available as fallback.
                </p>
              </div>

              {languages.map(lang => (
                <div key={lang.code} className="border border-border rounded-lg p-4">
                  <div className="flex items-center justify-between gap-2 mb-3">
                    <div className="flex items-center gap-2">
                      <Globe className="w-4 h-4 text-text-muted" />
                      <span className="font-semibold">{lang.native_name} ({lang.code.toUpperCase()})</span>
                    </div>
                    <button
                      type="button"
                      className="btn-secondary flex items-center gap-2"
                      onClick={() => addTranslationVersion(lang.code)}
                    >
                      <Plus className="w-4 h-4" />
                      Add Version
                    </button>
                  </div>

                  {(translationData[lang.code]?.versions || []).length === 0 ? (
                    <p className="text-sm text-text-muted">No versions yet. Click "Add Version" to create one.</p>
                  ) : (
                    <div className="space-y-3">
                      {(translationData[lang.code]?.versions || []).map((version, index) => (
                        <div key={`${lang.code}-version-${index}`} className="border border-border rounded-lg p-3 bg-gray-50">
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-sm font-medium">Version {index + 1}</span>
                            <button
                              type="button"
                              className="btn-danger flex items-center gap-2"
                              onClick={() => removeTranslationVersion(lang.code, index)}
                            >
                              <Trash2 className="w-4 h-4" />
                              Delete
                            </button>
                          </div>
                          <div className="space-y-2">
                            <div>
                              <label className="block text-sm font-medium mb-1">Quick Note / Version Name</label>
                              <input
                                type="text"
                                value={version.version_label || ''}
                                onChange={(e) => updateTranslationVersionField(lang.code, index, 'version_label', e.target.value)}
                                className="input"
                                placeholder="e.g. Warm follow-up, Short intro, Discount variant"
                              />
                            </div>
                            <div>
                              <label className="block text-sm font-medium mb-1">Title</label>
                              <input
                                type="text"
                                value={version.title}
                                onChange={(e) => updateTranslationVersionField(lang.code, index, 'title', e.target.value)}
                                className="input"
                                placeholder={lang.code === 'en' ? `Version title (base: ${editingTemplate.title})` : `Translate: ${editingTemplate.title}`}
                              />
                            </div>
                            <div>
                              <label className="block text-sm font-medium mb-1">Content</label>
                              <RichEmailEditor
                                value={version.content}
                                onChange={(nextValue) => updateTranslationVersionField(lang.code, index, 'content', nextValue)}
                                minHeightClass="min-h-[200px]"
                              />
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>

            <div className="flex gap-2 mt-6">
              <button onClick={handleSaveTranslations} disabled={saving} className="btn-primary flex items-center gap-2">
                <Save className="w-4 h-4" />
                {saving ? 'Saving...' : 'Save All Translations'}
              </button>
              <button onClick={() => setShowTranslationsModal(false)} className="btn-secondary">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Manage Categories Modal */}
      {showCategoryModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="card max-w-3xl w-full max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-xl font-bold">Manage Categories</h3>
              <button onClick={() => setShowCategoryModal(false)} className="text-text-muted hover:text-text">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="mb-6">
              <h4 className="font-semibold mb-3">Available Categories</h4>
              <div className="space-y-2">
                {categories.length === 0 ? (
                  <div className="text-sm text-text-muted">No categories yet. Add your first category below.</div>
                ) : (
                  categories.map((category) => (
                    <div key={category.code} className="flex items-center justify-between gap-3 p-3 bg-gray-50 rounded-lg border border-border">
                      <div className="min-w-0">
                        <div className="font-medium truncate">{category.name}</div>
                        <div className="text-xs text-text-muted">
                          <span className="font-mono">{category.code}</span> · {category.template_count} template{category.template_count === 1 ? '' : 's'}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          onClick={() => openEditCategoryModal(category)}
                          className="btn-secondary flex items-center gap-2"
                        >
                          <Pencil className="w-4 h-4" />
                          Edit
                        </button>
                        <button
                          onClick={() => handleDeleteCategory(category)}
                          className="btn-danger flex items-center gap-2"
                          disabled={saving}
                        >
                          <Trash2 className="w-4 h-4" />
                          Delete
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="border-t border-border pt-4">
              <h4 className="font-semibold mb-3">Add New Category</h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium mb-1">Category Code</label>
                  <input
                    type="text"
                    value={newCategory.code}
                    onChange={(e) => setNewCategory({ ...newCategory, code: e.target.value.toLowerCase().trim() })}
                    className="input"
                    placeholder="e.g., follow-up"
                    maxLength={50}
                  />
                  <p className="text-xs text-text-muted mt-1">Lowercase, numbers, hyphen, underscore</p>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Category Name</label>
                  <input
                    type="text"
                    value={newCategory.name}
                    onChange={(e) => setNewCategory({ ...newCategory, name: e.target.value })}
                    className="input"
                    placeholder="e.g., Follow-up objections"
                    maxLength={120}
                  />
                </div>
              </div>

              <div className="flex gap-2 mt-4">
                <button onClick={handleAddCategory} disabled={saving} className="btn-primary flex items-center gap-2">
                  <Plus className="w-4 h-4" />
                  {saving ? 'Adding...' : 'Add Category'}
                </button>
                <button onClick={() => setShowCategoryModal(false)} className="btn-secondary">
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Edit Category Modal */}
      {editingCategory && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-[60] p-4">
          <div className="card max-w-lg w-full">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-xl font-bold">Edit Category</h3>
              <button onClick={() => setEditingCategory(null)} className="text-text-muted hover:text-text">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium mb-1">Category Code</label>
                <input
                  type="text"
                  value={categoryEditData.code}
                  onChange={(e) => setCategoryEditData({ ...categoryEditData, code: e.target.value.toLowerCase().trim() })}
                  className="input"
                  maxLength={50}
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Category Name</label>
                <input
                  type="text"
                  value={categoryEditData.name}
                  onChange={(e) => setCategoryEditData({ ...categoryEditData, name: e.target.value })}
                  className="input"
                  maxLength={120}
                />
              </div>
            </div>

            <div className="flex gap-2 mt-6">
              <button onClick={handleUpdateCategory} disabled={saving} className="btn-primary flex items-center gap-2">
                <Save className="w-4 h-4" />
                {saving ? 'Saving...' : 'Save Category'}
              </button>
              <button onClick={() => setEditingCategory(null)} className="btn-secondary">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Manage Languages Modal */}
      {showLanguageModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="card max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-xl font-bold">Manage Languages</h3>
              <button onClick={() => setShowLanguageModal(false)} className="text-text-muted hover:text-text">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Current Languages */}
            <div className="mb-6">
              <h4 className="font-semibold mb-3">Supported Languages</h4>
              <div className="grid grid-cols-2 gap-2">
                {languages.map(lang => (
                  <div key={lang.code} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg border border-border">
                    <div>
                      <span className="font-medium">{lang.native_name}</span>
                      <span className="text-sm text-text-muted ml-2">({lang.code.toUpperCase()})</span>
                    </div>
                    {lang.code === 'en' && (
                      <span className="text-xs bg-primary/20 text-primary px-2 py-1 rounded">Base</span>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Add New Language */}
            <div className="border-t border-border pt-4">
              <h4 className="font-semibold mb-3">Add New Language</h4>
              <div className="space-y-3">
                <div>
                  <label className="block text-sm font-medium mb-1">Language Code (ISO 639)</label>
                  <input
                    type="text"
                    value={newLanguage.code}
                    onChange={(e) => setNewLanguage({ ...newLanguage, code: e.target.value.toLowerCase() })}
                    className="input"
                    placeholder="e.g., es, pt-br, zh-cn"
                    maxLength={7}
                  />
                  <p className="text-xs text-text-muted mt-1">Use ISO format, e.g. es, pt-br, zh-cn</p>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">English Name</label>
                  <input
                    type="text"
                    value={newLanguage.name}
                    onChange={(e) => setNewLanguage({ ...newLanguage, name: e.target.value })}
                    className="input"
                    placeholder="e.g., Spanish, Portuguese"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Native Name</label>
                  <input
                    type="text"
                    value={newLanguage.native_name}
                    onChange={(e) => setNewLanguage({ ...newLanguage, native_name: e.target.value })}
                    className="input"
                    placeholder="e.g., Español, Português"
                  />
                </div>
              </div>

              <div className="flex gap-2 mt-4">
                <button onClick={handleAddLanguage} disabled={saving} className="btn-primary flex items-center gap-2">
                  <Plus className="w-4 h-4" />
                  {saving ? 'Adding...' : 'Add Language'}
                </button>
                <button onClick={() => setShowLanguageModal(false)} className="btn-secondary">
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      </> /* end templates tab */}
    </div>
  );
}
