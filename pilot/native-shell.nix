# Compilation dependencies for the isolated Replit native pilot.
# Uses the configured Replit nixpkgs; deployment reproducibility still needs a pin.
{ pkgs ? import <nixpkgs> {} }:
pkgs.mkShell {
  packages = with pkgs; [
    openldap.dev
    cyrus_sasl.dev
    postgresql_16.dev
    postgresql_16.pg_config
    pkg-config
  ];
}
