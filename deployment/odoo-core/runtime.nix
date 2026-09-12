{ pkgs ? import (builtins.fetchTarball "https://github.com/NixOS/nixpkgs/archive/50ab793786d9de88ee30ec4e4c24fb4236fc2674.tar.gz") {} }:
 pkgs.mkShell { packages = with pkgs; [ python312 openldap.dev cyrus_sasl.dev postgresql_16.dev postgresql_16 pkg-config stdenv.cc.cc.lib ]; }
