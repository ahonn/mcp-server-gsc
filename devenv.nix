{ pkgs, lib, config, inputs, ... }:
{
  dotenv.enable = true;

  packages = [
    pkgs.git
  ];

  languages.javascript = {
    enable = true;
    package = pkgs.nodejs;
    corepack.enable = true;
  };
}
