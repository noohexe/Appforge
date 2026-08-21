#!/usr/bin/env node

import { Command } from "commander";

const program = new Command();

program
  .name("appforge")
  .description("Turn web apps into installable desktop and mobile apps")
  .version("0.1.0");

program
  .command("init")
  .description("Create a new AppForge project")
  .action(() => {
    console.log("🚀 AppForge init");
  });

program
  .command("dev")
  .description("Run your web app as a desktop app")
  .action(() => {
    console.log("🖥️ AppForge dev");
  });

program
  .command("build")
  .description("Build your application")
  .action(() => {
    console.log("📦 AppForge build");
  });

program
  .command("doctor")
  .description("Check your development environment")
  .action(() => {
    console.log("🩺 AppForge doctor");
  });

program.parse();