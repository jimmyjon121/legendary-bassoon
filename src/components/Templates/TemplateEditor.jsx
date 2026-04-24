import React, { useState, useEffect } from 'react';

// Extract variable names like {{variable}} from content
function extractVariables(content) {
  if (!content) return [];
  const matches = Array.from(content.matchAll(/{{\s*([\w-]+)\s*}}/g));
  const names = [...new Set(matches.map((m) => m[1]))];
  return names;
}

export function TemplateEditor({ template, workspace, onSave, onCancel }) {
  const [name, setName] = useState(template?.name || '');
  const [content, setContent] = useState(template?.content || '');
  const [category, setCategory] = useState(template?.category || 'General');
  const [targetWorkspace, setTargetWorkspace] = useState(template?.workspace || workspace || '');
  const [error, setError] = useState(null);
  const showPrivateWorkspaceOption = (
    template?.workspace === 'nsfw'
    || workspace === 'nsfw'
    || targetWorkspace === 'nsfw'
  );

  useEffect(() => {
    setError(null);
  }, [name, content]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('Name is required.');
      return;
    }
    if (!content.trim()) {
      setError('Content is required.');
      return;
    }

    const variables = extractVariables(content);
    await onSave?.({
      ...(template || {}),
      name: name.trim(),
      content,
      category: category || null,
      workspace: targetWorkspace || null,
      variables,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-xs font-medium text-text-secondary mb-1">
          Template name
        </label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="input text-sm"
          placeholder="e.g. Code review, Bug analysis, Meeting summary"
        />
      </div>

      <div className="flex gap-3">
        <div className="flex-1">
          <label className="block text-xs font-medium text-text-secondary mb-1">
            Category
          </label>
          <input
            type="text"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="input text-sm"
            placeholder="General, Code, Writing..."
          />
        </div>
        <div className="flex-1">
          <label className="block text-xs font-medium text-text-secondary mb-1">
            Workspace
          </label>
          <select
            value={targetWorkspace || ''}
            onChange={(e) => setTargetWorkspace(e.target.value || null)}
            className="input text-sm"
          >
            <option value="">All workspaces</option>
            <option value="casual">Casual</option>
            <option value="work">Work</option>
            <option value="code">Code</option>
            {showPrivateWorkspaceOption && <option value="nsfw">Vault</option>}
          </select>
        </div>
      </div>

      <div>
        <label className="block text-xs font-medium text-text-secondary mb-1">
          Prompt content
        </label>
        <textarea
          rows={6}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          className="input text-sm resize-none h-32"
          placeholder="Write the instruction you want to reuse. Use variables like {{input}} or {{language}}."
        />
        <p className="mt-1 text-[11px] text-text-muted">
          Detected variables:{' '}
          {extractVariables(content).length > 0
            ? extractVariables(content).map((v) => `{{${v}}}`).join(', ')
            : 'none'}
        </p>
      </div>

      {error && (
        <div className="text-xs text-status-error bg-status-error/10 border border-status-error/40 rounded px-3 py-2">
          {error}
        </div>
      )}

      <div className="flex items-center justify-end gap-2 pt-2 border-t border-forge-border">
        <button
          type="button"
          onClick={onCancel}
          className="btn btn-secondary text-xs"
        >
          Cancel
        </button>
        <button
          type="submit"
          className="btn btn-primary text-xs"
        >
          {template ? 'Save changes' : 'Create template'}
        </button>
      </div>
    </form>
  );
}

export default TemplateEditor;


