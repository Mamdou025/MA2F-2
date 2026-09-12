set -eu
umask 077
mkdir -p .local
revision=8da213dc6785e097f2558dc2d648b588957786a1
source_dir=.local/odoo-source
if [ ! -e "$source_dir/.git" ] || ! git -C "$source_dir" rev-parse --verify HEAD >/dev/null 2>&1; then
  git init "$source_dir"
  git -C "$source_dir" fetch --depth 1 https://github.com/odoo/odoo.git "$revision"
  if [ -f "$source_dir/odoo-bin" ]; then
    git -C "$source_dir" read-tree "$revision"
    git -C "$source_dir" diff --quiet "$revision" --
    git -C "$source_dir" update-ref HEAD "$revision"
  else
    git -C "$source_dir" checkout --detach FETCH_HEAD
  fi
fi
test "$(git -C "$source_dir" rev-parse HEAD)" = "$revision"
git -C "$source_dir" diff --quiet "$revision" --
printf '%s\n' "$revision" > .local/odoo-revision
nix-build https://github.com/NixOS/nixpkgs/archive/50ab793786d9de88ee30ec4e4c24fb4236fc2674.tar.gz -A bash --no-out-link > .local/bash-path
nix-build https://github.com/NixOS/nixpkgs/archive/50ab793786d9de88ee30ec4e4c24fb4236fc2674.tar.gz -A stdenv.cc.cc.lib --no-out-link > .local/cxx-runtime-path
export NIX_BUILD_SHELL="$(cat .local/bash-path)/bin/bash"
nix-shell runtime.nix --run 'python3.12 -m venv .local/venv && .local/venv/bin/pip install -r .local/odoo-source/requirements.txt && .local/venv/bin/python .local/odoo-source/odoo-bin --version'
echo ODOO_INSTALL_OK
python3 community_sources.py
