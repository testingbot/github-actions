import {FetchLike} from './api'

interface IssueComment {
    id: number
    body?: string
}

export function marker(tag: string): string {
    return `<!-- testingbot-report:${tag.replace(/-->/g, '')} -->`
}

/**
 * Creates or updates one sticky comment on a pull request, found by a hidden
 * marker, so re-runs and new pushes edit the same comment.
 * Needs `pull-requests: write` (or `issues: write`) on the token.
 */
export async function upsertPrComment(options: {
    token: string
    repository: string
    prNumber: number
    tag: string
    body: string
    apiUrl?: string
    fetchImpl?: FetchLike
}): Promise<'created' | 'updated'> {
    const api =
        options.apiUrl ||
        process.env['GITHUB_API_URL'] ||
        'https://api.github.com'
    const doFetch: FetchLike =
        options.fetchImpl ?? (async (input, init) => fetch(input, init))
    const headers = {
        Authorization: `Bearer ${options.token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
        'User-Agent': 'testingbot-github-actions'
    }
    const tag = marker(options.tag)
    const body = `${tag}\n${options.body}`
    const base = `${api}/repos/${options.repository}/issues`

    let existing: IssueComment | undefined
    for (let page = 1; page <= 10 && !existing; page++) {
        const res = await doFetch(
            `${base}/${options.prNumber}/comments?per_page=100&page=${page}`,
            {headers}
        )
        if (!res.ok) {
            throw new Error(
                `Listing PR comments failed: HTTP ${res.status} ${await res.text()}`
            )
        }
        const comments = (await res.json()) as IssueComment[]
        existing = comments.find(c => c.body?.startsWith(tag))
        if (comments.length < 100) break
    }

    const res = existing
        ? await doFetch(`${base}/comments/${existing.id}`, {
              method: 'PATCH',
              headers,
              body: JSON.stringify({body})
          })
        : await doFetch(`${base}/${options.prNumber}/comments`, {
              method: 'POST',
              headers,
              body: JSON.stringify({body})
          })
    if (!res.ok) {
        throw new Error(
            `Writing the PR comment failed: HTTP ${res.status} ${await res.text()}`
        )
    }
    return existing ? 'updated' : 'created'
}
