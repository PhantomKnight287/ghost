import { describe, expect, it } from 'vitest';

import {
  attachmentKey,
  attachmentTypeOf,
  isInlineAttachment,
} from './attachments.js';

describe('attachmentKey', () => {
  it('names an object, or the prefix of a repository', () => {
    expect(attachmentKey('repo_1', 'attachment_1')).toBe(
      'attachments/repo_1/attachment_1',
    );
    expect(attachmentKey('repo_1')).toBe('attachments/repo_1/');
  });
});

describe('attachmentTypeOf', () => {
  it('types a file by its extension, ignoring case', () => {
    expect(attachmentTypeOf('screenshot.PNG')).toBe('image/png');
    expect(attachmentTypeOf('IMG_0001.HEIC')).toBe('image/heic');
    expect(attachmentTypeOf('build.log')).toBe('text/plain');
    expect(attachmentTypeOf('logs.tar.gz')).toBe('application/gzip');
  });

  it('refuses anything a browser could run, or without an extension', () => {
    for (const name of [
      'page.html',
      'icon.svg',
      'script.js',
      'README',
      '.png',
    ]) {
      expect(attachmentTypeOf(name)).toBeUndefined();
    }
  });
});

describe('isInlineAttachment', () => {
  it('opens images and downloads everything else', () => {
    expect(isInlineAttachment('image/png')).toBe(true);
    expect(isInlineAttachment('application/pdf')).toBe(false);
    expect(isInlineAttachment('text/plain')).toBe(false);
  });
});
