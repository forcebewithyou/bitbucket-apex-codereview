import https from "https";
import path from "path";
import util from "util";
import { fetchPRComments } from "./fetchPRComments.js";
import { exec } from "child_process";
import { fileURLToPath } from "url";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename) + "/";

const execPromisified = util.promisify(exec);
const BUFFER_SIZE = 1024 * 5000;

const DIFF_FOLDER_NAME = "SrcDiff";
const PMD_PATH = "/pmd";
const [USERNAME, PASSWORD, PMD_RULE_PRIORITY, METADATA_FOLDER, ...others] =
  process.argv.slice(2);
const RULE_PRIORITY = PMD_RULE_PRIORITY;

// below section is to support with local development testing
// outside of pipeline context
const username = USERNAME ? USERNAME : "";
const password = PASSWORD ? PASSWORD : "";
const workspace = process.env.BITBUCKET_WORKSPACE
  ? process.env.BITBUCKET_WORKSPACE
  : "";
const repo_slug = process.env.BITBUCKET_REPO_SLUG
  ? process.env.BITBUCKET_REPO_SLUG
  : "";
const pull_request_id = process.env.BITBUCKET_PR_ID
  ? process.env.BITBUCKET_PR_ID
  : "";

const options = {
  hostname: "api.bitbucket.org",
  port: 443,
  path: `/2.0/repositories/${workspace}/${repo_slug}/pullrequests/${pull_request_id}/comments`,
  method: "POST",
  auth: `${username}:${password}`,
  headers: {
    "Content-Type": "application/json",
  },
};

async function runpmd() {
  const commentsByFile = await fetchPRComments(
    USERNAME,
    PASSWORD,
    workspace,
    repo_slug,
    pull_request_id
  );
  const { stdout, stderr } = await execPromisified(
    `${PMD_PATH}/bin/run.sh pmd -d ${__dirname}/../${DIFF_FOLDER_NAME}/force-app/main/default/${METADATA_FOLDER} -rulesets ${__dirname}/rules.xml -failOnViolation false -min ${RULE_PRIORITY} -f json`,
    { maxBuffer: BUFFER_SIZE }
  );
  let result = JSON.parse(`${stdout}`);
  let { files, processingErrors, configurationErrors } = result;

  files.map((file) => {
    let path = file.filename.replace(
      `${__dirname.substring(
        0,
        __dirname.lastIndexOf("/")
      )}/${DIFF_FOLDER_NAME}/`,
      ""
    );
    const existingCommentsOnFile = commentsByFile.filter((file) => {
      return file.fileName == path;
    });

    file.violations.map((violation) => {
      const contentRaw = `Rule : ${violation.rule} \\n  \\n  Priority : ${violation.priority} \\n  \\n  Issue : ${violation.description}   \\n  \\n  Reference : ${violation.externalInfoUrl}`;
      // cleansed version without espacing backslash is needed for comparison with retrieved comments
      const cleansedContentRaw = `Rule : ${violation.rule} \n  \n  Priority : ${violation.priority} \n  \n  Issue : ${violation.description}   \n  \n  Reference : ${violation.externalInfoUrl}`;
      const requestBody = `{"content":{"raw":"${contentRaw}"}, "inline":{"to":${violation.beginline}, "path":"${path}"}}`;
      // check if comments already exist if so then skip the same comment
      if (
        existingCommentsOnFile &&
        existingCommentsOnFile.length > 0 &&
        existingCommentsOnFile[0].comments
      ) {
        let hasComment = false;
        existingCommentsOnFile[0].comments.forEach((comment) => {
          if (
            comment.rawContent === cleansedContentRaw &&
            comment.lineNumber === violation.beginline
          ) {
            hasComment = true;
          }
        });
        if (!hasComment) {
          // post comment
          postPullRequestInlineCommentHttp(JSON.parse(requestBody));
        }
      } else {
        // post comment
        postPullRequestInlineCommentHttp(JSON.parse(requestBody));
      }
    });
  });
}

function postPullRequestInlineCommentHttp(body) {
  const req = https.request(options, (res) => {
    console.log(`statusCode: ${res.statusCode}`);
  });

  req.on("error", (error) => {
    console.error(error);
  });

  req.write(JSON.stringify(body));
  req.end();
}

runpmd();
