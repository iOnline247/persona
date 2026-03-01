#!/usr/bin/env node

/**
 * Hello World NodeJS Script
 * 
 * This is an example script that demonstrates:
 * - Command-line argument handling
 * - Basic output
 * - Exit codes
 * 
 * Usage: node hello.js [name]
 */

function main() {
  // Get the name from command-line arguments, default to "World"
  const args = process.argv.slice(2);
  const name = args[0] || 'World';

  // Display a greeting
  console.log(`Hello, ${name}!`);
  console.log(`This is a NodeJS script running from the run-script-example skill.`);
  console.log(`Script executed at: ${new Date().toISOString()}`);

  // Return success exit code
  process.exit(0);
}

// Run the main function
main();
