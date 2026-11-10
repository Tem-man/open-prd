import { params } from '@nanostores/i18n'

import { i18n } from '#vue/i18n/create'

/**
 * Canvas comments: the pins, their cards and the sidebar list. This shell has no shared
 * `common` namespace, so the card's `close`/`cancel` and the copy toast's `copied` live here.
 */
export const commentMessageDefaults = {
  comment: 'Comment',
  comments: 'Comments',
  close: 'Close',
  cancel: 'Cancel',
  copied: 'Copied',
  addComment: 'Add a comment',
  reply: 'Reply',
  send: 'Send',
  someone: 'Someone',
  resolve: 'Resolve',
  reopen: 'Reopen',
  delete: 'Delete',
  deleteComment: 'Delete comment?',
  deleteCommentDescription: 'This removes the comment and all of its replies for everyone.',
  deleteReply: 'Delete reply',
  copyText: 'Copy text',
  goToComment: 'Go to comment',
  moreActions: 'More actions',
  searchComments: 'Search comments',
  filterAndSort: 'Filter and sort',
  showResolved: 'Show resolved comments',
  onlyPage: 'Only current page',
  onlyMine: 'Only my threads',
  newestFirst: 'Newest first',
  oldestFirst: 'Oldest first',
  empty: 'No comments yet. Click the canvas to leave one.',
  noMatches: 'No comments match.',
  replyCount: params('Replies: {count}'),
  commentDeleted: 'Comment deleted',
  hideComments: 'Hide comments'
} as const

export const commentMessages = i18n('comments', commentMessageDefaults)
