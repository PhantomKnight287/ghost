import { describe, expect, it } from 'vitest';

import { applySuggestion, extractSuggestion } from './suggestion.js';

describe('extractSuggestion', () => {
  it('reads the first suggestion block and nothing else', () => {
    expect(
      extractSuggestion(
        'Try:\n```suggestion\nconst a = 1;\nconst b = 2;\n```\nthanks',
      ),
    ).toBe('const a = 1;\nconst b = 2;');
    expect(extractSuggestion('```suggestion\r\nx\r\n```')).toBe('x');
    expect(extractSuggestion('```suggestion\r\nx\r\n```\r\nthanks')).toBe('x');
  });

  it('reads an empty block as a deletion, and no block as no suggestion', () => {
    expect(extractSuggestion('```suggestion\n```')).toBe('');
    expect(extractSuggestion('```ts\nx\n```')).toBeNull();
    expect(extractSuggestion('no code here')).toBeNull();
  });
});

describe('applySuggestion', () => {
  it('replaces a range and keeps the final newline', () => {
    expect(applySuggestion('a\nb\nc\n', 2, 3, 'x')).toBe('a\nx\n');
    expect(applySuggestion('a\nb\nc', 1, 1, 'x\ny')).toBe('x\ny\nb\nc');
  });

  it('deletes lines for an empty suggestion', () => {
    expect(applySuggestion('a\nb\nc\n', 2, 2, '')).toBe('a\nc\n');
  });

  it('keeps CRLF files CRLF', () => {
    expect(applySuggestion('a\r\nb\r\n', 2, 2, 'x\ny')).toBe('a\r\nx\r\ny\r\n');
  });
});
