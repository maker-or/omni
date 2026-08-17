#!/bin/zsh
cd /Users/harshithpasupuleti/code/omni || exit 1
bun run fmt > /Users/harshithpasupuleti/code/omni/.tmp-check/fmt.log 2>&1
echo EXIT:$? >> /Users/harshithpasupuleti/code/omni/.tmp-check/fmt.log
