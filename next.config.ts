import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Fixa a raiz do workspace neste projeto. Evita que o Next infira a raiz a
  // partir de um package-lock.json perdido fora do projeto (ex.: no $HOME).
  turbopack: {
    root: import.meta.dirname,
  },
};

export default nextConfig;
