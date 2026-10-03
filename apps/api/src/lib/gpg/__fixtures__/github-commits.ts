/** A pull request merge GitHub signed with its current web-flow key, kept verbatim as GitHub wrote it. */
export const GITHUB_MERGE_COMMIT_OBJECT = `tree bde75b9bad69881cde77c83e8ba61c69abc0f7ab
parent f45d3438f7173457323dcea9429d7cf483077ca1
parent 7b74846a528005332a197d7aadbe004871843494
author Gurpal Singh <76196237+PhantomKnight287@users.noreply.github.com> 1791004918 +0530
committer GitHub <noreply@github.com> 1791004918 +0530
gpgsig -----BEGIN PGP SIGNATURE-----
 
 wsFcBAABCAAQBQJqwJD2CRC1aQ7uu5UhlAAA614QAF6pqkiu3O42DygPZ3wKIema
 mTLgRqQysfSKq40v4k1lW83dvQV3s61fYQEDx3bBw9aJwuXg+mRRnqneiIdoYNbb
 1LSAHp6ZqcecZ+qFYuzbQIDi6MaEavw8bNF4Kv1kJEoFBrvFMTKcMQ8Wrf4ETRdR
 UGe/s0Nd7+ERaMhDh4TRBFc6Q/OGaCrx+GZY51aeSESWRR+QGGSESy/r8yM60+NB
 irkBos6eFGIIBc2sRjA7vNATEudRLPldSsQKe7WS+YnPfL64EDMf1zshupTFL+pL
 pAKuSrogWuOnlS3Hw6Og9busK5x8W70vNp2GvmazXXijsVqjI3xJjT2yyQhJAo9j
 jEmmpSLNzqqvJuC481j2MDXrwhV8LqjmWnbO8xOkVvOywHvvGCnud26cKqFC/UbX
 RJq1PV/pxgjYGcNTMk0+gQ/5AhYVKJp2bj/z82qlWlAabLFA67wh1Gk92DczTtaU
 VD/HclWqFrhcFWFtEraJl5OcmAiZlyaHYjaT7BrhAEubTnLRA79XmqNY5F+rK5wl
 crzQ8hT3pFN66L4RkmJwZUgKuadus2VhAv8+UMDLEc9odlNRLkXx6JxjwsnkxwN4
 o26S766ktqOwYOGk+pV0/zmtr5n5d1Jh4QzLfUOVL1wn+4G6mNi1I+CvYO0tE6eK
 01bMoC225AmUysXwB4Lt
 =Fvhj
 -----END PGP SIGNATURE-----
 

Merge pull request #38 from PhantomKnight287/feat/push-validation

Verify a push before the log commits it
`;

/** A commit GitHub signed in 2023 with its web-flow key that has since expired, as GitHub's API returns it. */
export const GITHUB_EXPIRED_KEY_COMMIT = {
  payload: `tree 21e3d0462d063cbade9c0c2b2021029b193e51d1
parent eb85e79941ca77cd5b111d247718c9f3da3fa5cb
author Shohei Maeda <11495867+smaeda-ks@users.noreply.github.com> 1685660324 +0900
committer GitHub <noreply@github.com> 1685660324 +0000

Add new \`Google-InspectionTool\` token to known bot UA list (#50467)

Google apparently started using a new bot UA token recently:

- https://kw.linkedin.com/posts/garyillyes_google-crawler-user-agent-overview-google-activity-7064560799226175488-g_nh
- https://developers.google.com/search/docs/crawling-indexing/overview-google-crawlers#google-inspectiontool`,
  signature: `-----BEGIN PGP SIGNATURE-----

wsBcBAABCAAQBQJkeSKkCRBK7hj4Ov3rIwAAvK4IABIkS20XItSl08ClmprwY0n9
oRLGT5YaTihxL5TEEGTSa3/fDh7gH4c3x9YAMUvgNlv33QrJnGPn0mPtSO7xdA+J
ANhMgDBCeGtclQKWCJZNj4G1A6NOp43NRZwAPQX3iD2Rln/aPJv+gLsKkVUvaFAb
5YVMJxER5zaRygGmwVOtJKcu4ut+clYI35BF4XXW0OH/Z3lHOPbsFUhTXrHXsilU
kN15iyXnd4rP/KYeXivhoz8tc4KgNgcy5MFnuGDJNpKZiagF7OpatDaZ/wrNxpm9
xlXMC6i/ezMOw4XUuO48Y+/SRPW6QmQFFowKC/K/XjFubic91qDeRTChFcHHnMs=
=1DIl
-----END PGP SIGNATURE-----
`,
};
