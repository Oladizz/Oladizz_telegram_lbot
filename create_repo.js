const { Octokit } = require('@octokit/rest');

const token = process.argv[2]; // Token as first argument
const repoName = process.argv[3]; // Repo name as second argument

if (!token) {
    console.error("Token not provided as a command-line argument.");
    process.exit(1);
}
if (!repoName) {
    console.error("Repository name not provided as a command-line argument.");
    process.exit(1);
}

const octokit = new Octokit({ auth: token });

async function createRepo() {
    try {
        const response = await octokit.repos.createForAuthenticatedUser({
            name: repoName,
            private: true,
        });
        console.log(JSON.stringify(response.data)); // Log full response for debugging
    } catch (error) {
        if (error.status === 422) {
            console.log(JSON.stringify({ message: `Repository '${repoName}' already exists.`, status: 422 }));
        } else {
            console.error(JSON.stringify({ message: `Error creating repository: ${error.message}`, status: error.status }));
            process.exit(1);
        }
    }
}

createRepo();