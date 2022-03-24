import fetch from "node-fetch";

export async function fetchPRComments(
  username,
  password,
  workspace,
  repo_slug,
  pull_request_id
) {
  const options = {
    method: "GET",
    auth: `${username}:${password}`,
    headers: {
      Authorization:
        "Basic " + Buffer.from(username + ":" + password).toString("base64"),
      Accept: "application/json",
    },
  };
  const url = `https://api.bitbucket.org/2.0/repositories/${workspace}/${repo_slug}/pullrequests/${pull_request_id}/comments`;

  let response = await fetch(url, options);

  console.log(`Connected: ${response.status} ${response.statusText}`);

  let responsebody = JSON.parse(await response.text());
  let comments = responsebody.values;
  let currentPage = 1;
  const totalSize = parseInt(responsebody.size);
  const pageLength = parseInt(responsebody.pagelen);
  const totalPages = Math.ceil(totalSize / pageLength);
  let promisesArray = [];
  const commentsByFile = [];
  console.log(
    `Pulling ${totalSize} inline comments from PR ${pull_request_id}`
  );

  while (currentPage < totalPages) {
    currentPage++;
    promisesArray.push(fetch(`${url}?page=${currentPage}`, options));
  }

  let allReponses = await Promise.all(promisesArray);
  let responseBodyTextPromises = [];
  allReponses.forEach((eachResponse) => {
    responseBodyTextPromises.push(eachResponse.text());
  });
  let bodyTexts = await Promise.all(responseBodyTextPromises);
  bodyTexts.forEach((body) => {
    let parsedResponse = JSON.parse(body);
    comments = [...comments, ...parsedResponse.values];
  });

  comments.forEach((comment) => {
    // structure is as follows.
    // [{
    //   fileName :'',
    //   comments : [
    //               {
    //                 lineNumber : '',
    //                 htmlContent : '',
    //                 rawContent: ''
    //               }]
    // }]
    if (comment.inline) {
      let indexOfExistingFile = commentsByFile.findIndex((element) => {
        return element.fileName === comment.inline.path;
      });

      if (indexOfExistingFile > -1) {
        let matchedElement = commentsByFile[indexOfExistingFile];
        if (!matchedElement.comments) {
          matchedElement.comments = [];
        }
        matchedElement.comments.push({
          lineNumber: comment.inline.to,
          htmlContent: comment.content.html,
          rawContent: comment.content.raw,
        });
        commentsByFile[indexOfExistingFile] = matchedElement;
      } else {
        commentsByFile.push({
          fileName: comment.inline.path,
          comments: [
            {
              lineNumber: comment.inline.to,
              htmlContent: comment.content.html,
              rawContent: comment.content.raw,
            },
          ],
        });
      }
    }
  });

  if (commentsByFile.length > 0) {
    console.log(`Total files with comments - ${commentsByFile.length}`);
  } else {
    console.log("No comments found for the PR");
  }
  return commentsByFile;
}
