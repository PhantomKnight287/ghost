import { render } from '@react-email/components';
import { describe, expect, it } from 'vitest';

import ThreadAssigned from './templates/thread-assigned.js';
import ThreadComment from './templates/thread-comment.js';
import ThreadOpened from './templates/thread-opened.js';
import ThreadReview from './templates/thread-review.js';
import ThreadState from './templates/thread-state.js';

const plain = (element: React.ReactElement) =>
  render(element, { plainText: true });

describe('thread emails', () => {
  it('link to the thread and say why the reader got them', async () => {
    const text = await plain(<ThreadOpened {...ThreadOpened.PreviewProps} />);
    expect(text).toContain('bob opened this issue.');
    expect(text).toContain('The bell should show');
    expect(text).toContain('http://localhost:3000/alice/ghost/issues/42');
    expect(text).toContain('you are watching this repository');
    expect(
      await plain(<ThreadOpened {...ThreadOpened.PreviewProps} body={null} />),
    ).not.toContain('The bell');
  });

  it('name the file a review comment is on', async () => {
    const props = ThreadComment.PreviewProps;
    expect(await plain(<ThreadComment {...props} />)).toContain(
      'bob commented:',
    );
    expect(
      await plain(<ThreadComment {...props} file="src/bell.tsx" />),
    ).toContain('bob commented on src/bell.tsx:');
  });

  it('state the verdict and how many line comments came with it', async () => {
    const props = ThreadReview.PreviewProps;
    const text = await plain(<ThreadReview {...props} />);
    expect(text).toContain('Changes requested');
    expect(text).toContain(
      'bob requested changes on this pull request and left 2 comments.',
    );
    expect(
      await plain(
        <ThreadReview
          {...props}
          state="approved"
          commentCount={1}
          body={null}
        />,
      ),
    ).toContain('bob approved this pull request and left 1 comment.');
    expect(
      await plain(
        <ThreadReview {...props} state="commented" commentCount={0} />,
      ),
    ).toContain('bob reviewed this pull request.');
  });

  it('say "you" to the person assigned and name them to everyone else', async () => {
    const props = ThreadAssigned.PreviewProps;
    expect(await plain(<ThreadAssigned {...props} />)).toContain(
      'bob assigned you to this issue.',
    );
    expect(
      await plain(<ThreadAssigned {...props} reason="subscribed" />),
    ).toContain('bob assigned alice to this issue.');
  });

  it('show what happened to the thread', async () => {
    const text = await plain(<ThreadState {...ThreadState.PreviewProps} />);
    expect(text).toContain('Merged');
    expect(text).toContain('bob merged this pull request.');
  });
});
