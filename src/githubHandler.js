const { Octokit } = require('@octokit/rest');
const { downloadFile } = require('./utils');
const path = require('path');
const fs = require('fs');
const { FieldValue } = require('firebase-admin/firestore');

function handleGitHubError(error, chatId, bot) {
    console.error("GitHub API error:", error.message);
    if (error.status === 404) {
        bot.sendMessage(chatId, "Resource not found. Please check the names and try again.");
    } else if (error.status === 401) {
        bot.sendMessage(chatId, "Authentication failed. Your GitHub token is likely invalid or has expired.");
    } else if (error.status === 422) {
        bot.sendMessage(chatId, "Validation failed. This can happen if a repository with the same name already exists.");
    } else {
        bot.sendMessage(chatId, "An error occurred with the GitHub API. Please try again later.");
    }
}

function registerGithubHandlers(bot, db, tempDir) {
    bot.on('callback_query', async (callbackQuery) => {
        const msg = callbackQuery.message;
        const chatId = msg.chat.id;
        const data = callbackQuery.data;
        const userRef = db.collection('user_states').doc(String(chatId));

        bot.answerCallbackQuery(callbackQuery.id);

        const userDoc = await userRef.get();
        const state = userDoc.exists ? userDoc.data() : {};

        if (data === 'github') {
            const githubOpts = {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: 'Set Token', callback_data: 'set_token' }],
                        [{ text: 'Get Repo Info', callback_data: 'get_repo_info' }, { text: 'Search Repos', callback_data: 'search_repos' }],
                        [{ text: 'Deep Search Repos', callback_data: 'github_deep_search' }],
                        [{ text: 'Create Repo', callback_data: 'create_repo' }, { text: 'Upload File', callback_data: 'upload_file' }, { text: 'Create Issue', callback_data: 'create_issue' }],
                        [{ text: 'List Branches', callback_data: 'list_branches' }, { text: 'List Commits', callback_data: 'list_commits' }, { text: 'Get Commit', callback_data: 'github_get_commit' }],
                        [{ text: 'Search Users', callback_data: 'github_search_users' }, { text: 'List Gists', callback_data: 'github_list_gists' }],
                        [{ text: '⬅️ Back', callback_data: 'dev_tools' }]
                    ]
                }
            };
            return bot.editMessageText("GitHub Features:", { chat_id: chatId, message_id: msg.message_id, reply_markup: githubOpts.reply_markup });
        }
        
        if (data === 'github_deep_search') {
            await userRef.set({ action: 'awaiting_deep_search_query', deepSearchData: {} }, { merge: true });
            return bot.sendMessage(chatId, "🔬 Deep Search | Step 1/4\n\nPlease enter your search keywords (e.g., 'telegram bot').");
        }

        if (data.startsWith('de_sort_')) {
            if (!state || !state.deepSearchData) return;
            const sort = data.replace('de_sort_', '');
            await userRef.update({ 'deepSearchData.sort': sort });
            bot.editMessageText("⚙️ Building query and searching...", { chat_id: chatId, message_id: msg.message_id });

            const updatedState = (await userRef.get()).data();
            const { query, language, minStars } = updatedState.deepSearchData;
            let q = query;
            if (language) q += ` language:${language}`;
            if (minStars) q += ` stars:>=${minStars}`;
            
            const token = updatedState.github_pat;
            if (!token) {
                bot.sendMessage(chatId, "Please set your GitHub token first.");
                return userRef.delete();
            }
            try {
                const octokit = new Octokit({ auth: token });
                const { data: searchData } = await octokit.search.repos({ q, sort, order: 'desc', per_page: 10 });
                let message = `*Found ${searchData.total_count} results for your deep search:*

`;
                if (searchData.items.length === 0) {
                    message = "No repositories found for your specific criteria.";
                } else {
                    searchData.items.forEach(repo => {
                        message += `*${repo.full_name}* (⭐️ ${repo.stargazers_count})
*Desc:* ${repo.description ? repo.description.substring(0, 100) : 'N/A'}...
[View on GitHub](${repo.html_url})

`;
                    });
                }
                bot.sendMessage(chatId, message, { parse_mode: 'Markdown', disable_web_page_preview: true });
            } catch (error) {
                handleGitHubError(error, chatId, bot);
            } finally {
                await userRef.delete();
            }
            return;
        }

        const actionMap = {
            'set_token': { state: { action: 'awaiting_token' }, message: "Please send me your GitHub Personal Access Token. I will delete your message for security." },
            'get_repo_info': { state: { action: 'awaiting_repo_for_info' }, message: "Please send me the repository in the format `owner/repo`." },
            'create_repo': { state: { action: 'awaiting_repo_for_creation' }, message: "Please send the name for the new repository (e.g., `my-cool-repo`). Add `private` for a private repo." },
            'upload_file': { state: { action: 'awaiting_file_for_upload' }, message: "Okay, please send me the file you want to upload." },
            'list_branches': { state: { action: 'awaiting_repo_for_branches' }, message: "Please send the repository in the format `owner/repo`." },
            'list_commits': { state: { action: 'awaiting_repo_branch_for_commits' }, message: "Please send the repository and branch in the format `owner/repo branch`." },
            'create_issue': { state: { action: 'awaiting_issue_details' }, message: "Please send the issue details in the format `owner/repo | issue title | issue body`." },
            'search_repos': { state: { action: 'awaiting_search_query' }, message: "Please send your search query for repositories." },
            'github_search_users': { state: { action: 'awaiting_user_search_query' }, message: "Please send a username or email to search for." },
            'github_list_gists': { state: { action: 'awaiting_username_for_gists' }, message: "Please send the username to list their public gists." },
            'github_get_commit': { state: { action: 'awaiting_commit_details' }, message: "Please send the repository and commit hash in the format `owner/repo commit_hash`." }
        };

        if (actionMap[data]) {
            await userRef.set(actionMap[data].state, { merge: true });
            bot.sendMessage(chatId, actionMap[data].message, { parse_mode: 'Markdown'});
        }
    });

    bot.on('text', async (msg) => {
        const chatId = msg.chat.id;
        const text = msg.text;
        const userRef = db.collection('user_states').doc(String(chatId));
        const userDoc = await userRef.get();
        
        if (text.startsWith('/') || !userDoc.exists) return;

        const state = userDoc.data();
        const token = state.github_pat;
        const octokit = token ? new Octokit({ auth: token }) : new Octokit();

        const handleAction = async (action) => {
            await userRef.update({ action: FieldValue.delete() });
            try {
                await action();
            } catch (error) {
                handleGitHubError(error, chatId, bot);
            }
        };

        switch (state.action) {
            case 'awaiting_deep_search_query':
                await userRef.update({ 'deepSearchData.query': text, action: 'awaiting_deep_search_language' });
                bot.sendMessage(chatId, "🔬 Deep Search | Step 2/4\n\nFilter by language? (e.g., 'javascript'). Send 'skip' for any.");
                break;
            case 'awaiting_deep_search_language':
                if (text.toLowerCase() !== 'skip') {
                    await userRef.update({ 'deepSearchData.language': text });
                }
                await userRef.update({ action: 'awaiting_deep_search_stars' });
                bot.sendMessage(chatId, "🔬 Deep Search | Step 3/4\n\nFilter by minimum stars? (e.g., '100'). Send 'skip' for any.");
                break;
            case 'awaiting_deep_search_stars':
                if (text.toLowerCase() !== 'skip') {
                    const minStars = parseInt(text, 10);
                    if (isNaN(minStars) || minStars < 0) {
                        return bot.sendMessage(chatId, "Please enter a valid number or 'skip'.");
                    }
                    await userRef.update({ 'deepSearchData.minStars': minStars });
                }
                await userRef.update({ action: 'awaiting_deep_search_sort' });
                const opts = { reply_markup: { inline_keyboard: [
                    [{ text: 'Best Match', callback_data: 'de_sort_best-match' }],
                    [{ text: 'Most Stars', callback_data: 'de_sort_stars' }],
                    [{ text: 'Most Forks', callback_data: 'de_sort_forks' }],
                    [{ text: 'Recently Updated', callback_data: 'de_sort_updated' }]
                ]}};
                bot.sendMessage(chatId, "🔬 Deep Search | Step 4/4\n\nHow should the results be sorted?", opts);
                break;
            
            case 'awaiting_token':
                await userRef.set({ github_pat: text }, { merge: true });
                await userRef.update({ action: FieldValue.delete() });
                bot.deleteMessage(chatId, msg.message_id);
                bot.sendMessage(chatId, "Your GitHub token has been saved.");
                break;

            case 'awaiting_repo_for_info':
                handleAction(async () => {
                    const [owner, repo] = text.split('/');
                    if (!owner || !repo) return bot.sendMessage(chatId, "Invalid format. Use `owner/repo`.");
                    const { data } = await octokit.repos.get({ owner, repo });
                    const message = `*${data.full_name}*
*Desc:* ${data.description || 'N/A'}
*Stars:* ${data.stargazers_count}
*Forks:* ${data.forks_count}
*Lang:* ${data.language || 'N/A'}`;
                    bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
                });
                break;

            case 'awaiting_repo_for_creation':
                handleAction(async () => {
                    const args = text.split(' ');
                    const repoName = args[0];
                    const privacy = args[1] === 'private';
                    const { data } = await octokit.repos.createForAuthenticatedUser({ name: repoName, private: privacy });
                    bot.sendMessage(chatId, `Repository *${data.full_name}* created! URL: ${data.html_url}`, { parse_mode: 'Markdown' });
                });
                break;

            case 'awaiting_upload_details':
                 handleAction(async () => {
                    const details = text.split(' ');
                    if (details.length !== 3) return bot.sendMessage(chatId, "Invalid format: `owner/repo branch path/to/file.ext`");
                    const [repoFullName, branch, filePath] = details;
                    const [owner, repo] = repoFullName.split('/');
                    if (!owner || !repo) return bot.sendMessage(chatId, "Invalid repo format: `owner/repo`.");
                    
                    bot.sendMessage(chatId, "Processing upload...");
                    const fileLink = await bot.getFileLink(state.file_id);
                    const fileContent = await downloadFile(fileLink);
                    const contentEncoded = fileContent.toString('base64');

                    try {
                        await octokit.repos.getBranch({ owner, repo, branch });
                    } catch (error) {
                        if (error.status === 404) {
                            const { data: repoData } = await octokit.repos.get({ owner, repo });
                            const { data: refData } = await octokit.git.getRef({ owner, repo, ref: `heads/${repoData.default_branch}` });
                            await octokit.git.createRef({ owner, repo, ref: `refs/heads/${branch}`, sha: refData.object.sha });
                            bot.sendMessage(chatId, `Branch '${branch}' created.`);
                        } else { throw error; }
                    }

                    await octokit.repos.createOrUpdateFileContents({ owner, repo, path: filePath, message: `feat: upload ${state.file_name}`, content: contentEncoded, branch });
                    bot.sendMessage(chatId, `File *${state.file_name}* uploaded to *${repoFullName}* on branch *${branch}*!`, { parse_mode: 'Markdown' });
                });
                break;

            case 'awaiting_repo_for_branches':
                handleAction(async () => {
                    const [owner, repo] = text.split('/');
                    if (!owner || !repo) return bot.sendMessage(chatId, "Invalid format. Use `owner/repo`.");
                    const { data } = await octokit.repos.listBranches({ owner, repo });
                    let message = `*Branches in ${owner}/${repo}:*
` + data.map(b => `- ${b.name}`).join('\n');
                    bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
                });
                break;

            case 'awaiting_repo_branch_for_commits':
                handleAction(async () => {
                    const [repoFullName, branch] = text.split(' ');
                    if (!repoFullName || !branch) return bot.sendMessage(chatId, "Invalid format. Use `owner/repo branch`.");
                    const [owner, repo] = repoFullName.split('/');
                    if (!owner || !repo) return bot.sendMessage(chatId, "Invalid repo format. Use `owner/repo`.");
                    const { data } = await octokit.repos.listCommits({ owner, repo, sha: branch, per_page: 5 });
                    let message = `*Recent commits on ${branch} in ${repoFullName}:*
` + data.map(c => `- ${c.sha.substring(0, 7)} by ${c.commit.author.name}: ${c.commit.message.split('\n')[0]}`).join('\n');
                    bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
                });
                break;

            case 'awaiting_issue_details':
                handleAction(async () => {
                    const parts = text.split(' | ');
                    if (parts.length !== 3) return bot.sendMessage(chatId, "Invalid format: `owner/repo | title | body`");
                    const [repoFullName, title, body] = parts;
                    const [owner, repo] = repoFullName.split('/');
                    if (!owner || !repo) return bot.sendMessage(chatId, "Invalid repo format: `owner/repo`.");
                    const { data } = await octokit.issues.create({ owner, repo, title, body });
                    bot.sendMessage(chatId, `Issue *#${data.number}* created in *${repoFullName}*! URL: ${data.html_url}`, { parse_mode: 'Markdown' });
                });
                break;
            
            case 'awaiting_search_query':
                handleAction(async () => {
                    const { data } = await octokit.search.repos({ q: text, per_page: 5 });
                    let message = `*Search results for "${text}":*
`;
                    if (data.items.length === 0) message += "No repositories found.";
                    else message += data.items.map(repo => `- *${repo.full_name}* (${repo.stargazers_count} stars)`).join('\n');
                    bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
                });
                break;

            case 'awaiting_user_search_query':
                handleAction(async () => {
                    const { data } = await octokit.search.users({ q: text, per_page: 5 });
                    let message = `*Search results for "${text}":*\n`;
                    if (data.items.length === 0) message += "No users found.";
                    else message += data.items.map(user => `- *${user.login}* - ${user.html_url}`).join('\n');
                    bot.sendMessage(chatId, message, { parse_mode: 'Markdown', disable_web_page_preview: true });
                });
                break;
            
            case 'awaiting_username_for_gists':
                handleAction(async () => {
                    const { data } = await octokit.gists.listForUser({ username: text, per_page: 5 });
                    let message = `*Public gists for ${text}:*\n`;
                    if (data.length === 0) message += "No public gists found.";
                    else message += data.map(gist => `- *${Object.keys(gist.files)[0]}*: ${gist.html_url}`).join('\n');
                    bot.sendMessage(chatId, message, { parse_mode: 'Markdown', disable_web_page_preview: true });
                });
                break;

            case 'awaiting_commit_details':
                handleAction(async () => {
                    const [repoFullName, commit_sha] = text.split(' ');
                    if (!repoFullName || !commit_sha) return bot.sendMessage(chatId, "Invalid format: `owner/repo commit_hash`");
                    const [owner, repo] = repoFullName.split('/');
                    if (!owner || !repo) return bot.sendMessage(chatId, "Invalid repo format: `owner/repo`.");
                    const { data } = await octokit.git.getCommit({ owner, repo, commit_sha });
                    let message = `*Commit ${data.sha.substring(0, 7)}:*
`;
                    message += `*Author:* ${data.author.name} <${data.author.email}>
`;
                    message += `*Date:* ${new Date(data.author.date).toUTCString()}
`;
                    message += `*Message:* 
${data.message}`;
                    bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
                });
                break;
        }
    });
}

module.exports = {
    registerGithubHandlers,
};