import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AppModal } from './AppModal';

describe('AppModal UI Primitive', () => {
  it('does not render markup when isOpen is false', () => {
    const html = renderToStaticMarkup(
      <AppModal isOpen={false} onClose={() => {}} title="Test Modal">
        <p>Modal content</p>
      </AppModal>
    );

    expect(html).toBe('');
  });

  it('renders title, subtitle, content, and actions when isOpen is true', () => {
    const html = renderToStaticMarkup(
      <AppModal
        isOpen={true}
        onClose={() => {}}
        title="Settings Dialog"
        subtitle="Configure your preferences"
        actions={<button type="button">Save Changes</button>}
      >
        <p>Main body content</p>
      </AppModal>
    );

    expect(html).toContain('Settings Dialog');
    expect(html).toContain('Configure your preferences');
    expect(html).toContain('Main body content');
    expect(html).toContain('Save Changes');
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
  });

  it('renders with custom size classes and close button', () => {
    const html = renderToStaticMarkup(
      <AppModal
        isOpen={true}
        onClose={() => {}}
        title="Closable Modal"
        size="lg"
        showCloseButton={true}
      >
        <p>Content</p>
      </AppModal>
    );

    expect(html).toContain('max-w-lg');
    expect(html).toContain('data-testid="app-modal-close-btn"');
    expect(html).not.toContain('aria-label="closeDialog"');
    expect(html).toContain('aria-label="Close dialog"');
  });
});
