#!/usr/bin/env bash

# For debugging
echo $(date)
echo $PWD
ls -al

# This makes a symlnk @ ``.claude/command` which routes to `../.agents/commands`
# The symlink syntax runs in the context of the .claude directory, **NOT** the $PWD.
# Why Bash syntax is so goofy, I don't even know.
ln -sfn ../.agents/commands .github/agents

# Check if git is initialized.
# $LASTEXITCODE for bash is $?.
if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  git init
  # Set branch name to main to avoid confusion with older git versions defaulting to master.
  git branch -M main
  git add .
  git -c user.name="Matthew Bramer" -c user.email="515152+iOnline247@users.noreply.github.com" commit -m "Initial commit from https://github.com/iOnline247/accoutreai."
fi
