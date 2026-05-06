# 02 — GitHub: where code lives

If you've built something on a computer, you know the sick feeling of accidentally deleting a file you needed. You reach for undo. Nothing. You look in the recycle bin. Empty. Hours of work, gone.

Programmers had that feeling too, and they built something to solve it. It's called Git.

Git is a system for keeping a complete history of every version of every file in a project. Every time you save a meaningful change — called a **commit** — Git remembers what the files looked like before and after. You can go back to any commit from any time, see exactly what changed, and restore the old version if you need to. It's like save scumming in a video game, except for your entire work.

Git works on your own computer. It does not need the internet. You could use Git alone on a laptop with no network and still have full history.

**GitHub** is a website that stores Git projects online, so you can share them with other people or with your future self. When you see `github.com/someone/project-name` in a link, that's a Git project hosted on GitHub.

Daylila lives at `github.com/zzeeshann/daylila-v2`. That URL points to a folder of files, plus every version of every file that has ever existed in that project. Click "Commits" on GitHub and you can see the entire history, including this book being added to it.

## What GitHub gives you, beyond storage

Three things.

**A shared place.** If three people are working on the same project, they can't all have the files on their own laptops and hope the files stay in sync. GitHub is the shared copy everyone agrees is the real one. You "push" your changes up to GitHub. Someone else "pulls" them down.

**A history everyone can see.** Every commit has a message — a sentence explaining what changed and why. This means six months from now, when you look at a weird-looking line of code, you can find the commit that added it and read the reasoning. This is enormous. Real projects depend on it.

**A way to catch problems before they land.** GitHub has a feature called **pull requests**. When someone wants to add a change, they propose it as a pull request instead of shoving it straight into the main version. Other people review the change, comment, suggest fixes. Only when everyone agrees does the change get merged. This stops a lot of bad code from reaching the real thing.

## How Daylila uses GitHub

Daylila's code lives in a GitHub repository. So do the daily pieces, the documentation, and now this book. Every word you are reading is a file that was committed to the repo with a commit message.

When a Daylila agent finishes writing a daily piece, the Publisher agent literally saves it as a file and commits it to GitHub. The commit message says which piece it is and when it published. You can go look.

GitHub also runs **GitHub Actions** — a feature that automatically runs tasks when something happens in the repo. Every time Daylila code is pushed to the main version of the repo, GitHub Actions deploys it to Cloudflare. The developer doesn't have to run a deploy command. The commit itself triggers the deploy. This is how production software stays current without someone manually shipping each change.

## The vocabulary, compressed

- **Repository** (or **repo**): the folder of files plus all their history. Daylila is one repo.
- **Commit**: a saved snapshot of a change, with a message explaining it.
- **Push**: send your local commits up to GitHub.
- **Pull**: bring GitHub's commits down to your local copy.
- **Branch**: a parallel version of the files, used for working on a change without affecting the main version. When the change is ready, the branch is **merged** back in.
- **Pull request**: a proposal to merge a branch, reviewed before it lands.
- **main**: the branch everyone treats as the canonical version. Used to be called `master` in older projects.

## The small honest thing about GitHub

It is owned by Microsoft. It is free for open-source projects and for most small teams. It is not the only place code can live — alternatives exist, like GitLab and Codeberg. Daylila uses GitHub because the ecosystem around it (Actions, the community, the tooling) is the most developed, and because the whole thing is public anyway. If you prefer a different platform, the underlying Git tool works identically everywhere.
