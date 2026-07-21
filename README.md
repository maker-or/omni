# Pipper

pipper is agentic inference which can update it-self

## Purpose

every individual has a different way of working , so instead of we adapting to the new tools and worlflow , what if the tool can evolve around us , think it as a claude code or codex instance costumoized to each individual's needs?

and pipper is built on ACP so it support many agents out of the box like claude code , codex , cursor , opencode , Grok, this open a completely new way to interact with all these agent , like i can use sol as orchitrator to spin up composer 2.5

## INSTALLATION
You can download actaul application from the pipper[https://www.pipper.dev/download] both the mac and windows builds are unsigned to for mac after droping the DMG into your Applications folder. run the following command in the terminal ```xattr -cr "/Applications/Pipper Code (Alpha).app"``` for the windows build i have seens the its running in the older windows machine , i can do much here

## Architecture: self-improving software

Pipper has a **launcher** and a mutable **active workspace**. The launcher is the stable shell you install and update like a normal desktop app. The active workspace is the real application source Pipper runs and that is what you customize and improve

**Git** is the source of truth for those customizations. The active workspace is a git repository. When you accept an edit ,  Pipper stages only the files that session changed and commits them. 

**`patch.md`** is like a semantic engine that keeps track of why , what did you change, Pipper adds a small JSON entry (`change_id`, `files_changed`, `intent` , `git hash`) to `patch.md` and commits it with the code. During self-updates, the updater agent is instructed to treat `patch.md` as a map of local edits and to use each `change_id` with `git log -S` when it needs the exact prior change.

## CODEX GPT-5.6
i have only used terra on high reasoning i don't say it has one shoted things for me but mostly fast tracked the development process , i used to read the docs and also ask the codex to read it later i will ask it to come up with a plan we go back and forth , but when it comes to desgin i am feedup with 5.6 not following the design system in place and comming up with its own things
