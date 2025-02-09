const { sumTokens2 } = require("../../helper/unwrapLPs");
const abi = require("./abis");
const {
  VAULTS_ADDRESSES,
  BAYC_VAULTS,
  MAYC_VAULTS,
  BAYC_APE_STAKING_STRATEGY,
  MAYC_APE_STAKING_STRATEGY,
  BAKC_BAYC_STAKING_STRATEGY,
  BAKC_MAYC_STAKING_STRATEGY,
  APE_STAKING,
  STAKING_CONTRACT,
  APE,
  BAKC,
  JPEG,
  helperToNftMapping,
  artBlockOwners,
} = require("./addresses");

/**
 *
 * @returns JPEG'd deposit addresses for APE Staking
 */
async function getApeDepositAddresses(api) {
  const [baycPositionIndices, maycPositionIndices] = await Promise.all([
    api.multiCall({
      abi: abi.VAULT_ABI.openPositionIndices,
      calls: BAYC_VAULTS,
    }),
    api.multiCall({
      abi: abi.VAULT_ABI.openPositionIndices,
      calls: MAYC_VAULTS,
    }),
  ]);

  const [baycOwners, maycOwners] = await Promise.all([
    api.multiCall({
      abi: abi.VAULT_ABI.positionOwner,
      calls: baycPositionIndices
        .map((vaultIndices, i) =>
          vaultIndices.map((nftIndex) => ({
            target: BAYC_VAULTS[i],
            params: [nftIndex.toString()],
          }))
        )
        .flat(),
    }),
    api.multiCall({
      abi: abi.VAULT_ABI.positionOwner,
      calls: maycPositionIndices
        .map((vaultIndices, i) =>
          vaultIndices.map((nftIndex) => ({
            target: MAYC_VAULTS[i],
            params: [nftIndex.toString()],
          }))
        )
        .flat(),
    }),
  ]);

  const [baycDepositAddresses, maycDepositAddresses] = await Promise.all([
    api.multiCall({
      abi: abi.STRATEGY_ABI.depositAddress,
      calls: [...new Set(baycOwners)].map((owner) => ({
        target: BAYC_APE_STAKING_STRATEGY,
        params: [owner],
      })),
    }),
    api.multiCall({
      abi: abi.STRATEGY_ABI.depositAddress,
      calls: [...new Set(maycOwners)].map((owner) => ({
        target: MAYC_APE_STAKING_STRATEGY,
        params: [owner],
      })),
    }),
  ]);

  return Array.from(new Set(baycDepositAddresses)).concat(
    Array.from(new Set(maycDepositAddresses))
  );
}

/**
 * @returns the amount of JPEG locked on JPEG'd (trait or ltv boosts)
 */
async function stakingJPEGD(_, _1, _2, { api }) {
  const providersAddresses = await api.multiCall({
    abi: "address:nftValueProvider",
    calls: VAULTS_ADDRESSES,
  });

  providersAddresses.push(STAKING_CONTRACT)

  return sumTokens2({ owners: providersAddresses, tokens: [JPEG], api })
}

/**
 * @returns the amount of $APE tokens staked on JPEG'd
 */
async function getStakedApeAmount(api) {
  const apeDepositAddresses = await getApeDepositAddresses(api);
  const apeStakes = await api.multiCall({
    abi: abi.APE_STAKING.stakedTotal,
    target: APE_STAKING,
    calls: apeDepositAddresses,
  })
  apeStakes.forEach(v => api.add(APE, v))
}

/**
 * @returns the amount of wallet staked BAKC NFTs on JPEG'd
 */
async function getWalletStakedBakcCount(api) {
  const apeDepositAddresses = await getApeDepositAddresses(api);

  const bakcBalances = await api.multiCall({
    abi: "erc20:balanceOf",
    target: BAKC,
    calls: apeDepositAddresses,
  });

  const bakcIdsBN = await api.multiCall({
    abi: abi.ERC721.tokenOfOwnerByIndex,
    target: BAKC,
    calls: apeDepositAddresses
      .map((owner, i) =>
        Array.from({ length: bakcBalances[i].toString() }).map((_, j) => ({
          params: [owner, j],
        }))
      )
      .flat(),
  });

  const bakcIds = Array.from(new Set(bakcIdsBN.map((id) => id.toString())));
  const ownerBakcIndexTuples = bakcIds.map((bakcId) => [
    "0x0000000000000000000000000000000000000000", // random owner address, it's not used. just for consistent parameters
    bakcId.toString(),
  ]);

  const [isNonLegacyBaycStaked, isNonLegacyMaycStaked] = await Promise.all([
    api.multiCall({
      abi: abi.STRATEGY_ABI.isDeposited,
      calls: ownerBakcIndexTuples.map((params) => ({
        target: BAKC_BAYC_STAKING_STRATEGY,
        params,
      })),
    }),
    api.multiCall({
      abi: abi.STRATEGY_ABI.isDeposited,
      calls: ownerBakcIndexTuples.map((params) => ({
        target: BAKC_MAYC_STAKING_STRATEGY,
        params,
      })),
    }),
  ]);

  bakcIds.forEach((_, i) => {
    const legacyBakc = !isNonLegacyBaycStaked[i] && !isNonLegacyMaycStaked[i];
    if (legacyBakc) api.add(BAKC, 1)
  });
}

async function vaultsTvl(api) {
  // Fetch positions from vaults
  const positions = await api.multiCall({ calls: VAULTS_ADDRESSES, abi: abi.VAULT_ABI.totalPositions, })
  let tokens = await api.multiCall({ abi: 'address:nftContract', calls: VAULTS_ADDRESSES })
  tokens = tokens.map(i => i.toLowerCase())
  const transform = t => helperToNftMapping[t.toLowerCase()] || t

  tokens.forEach((v, i) => {
    if (artBlockOwners.has(v)) return;
    api.add(transform(v), positions[i])
  })
}

async function tvl(ts, b, cb, { api }) {
  await Promise.all([
    getStakedApeAmount(api),
    getWalletStakedBakcCount(api),
    vaultsTvl(api),
    sumTokens2({ api, resolveArtBlocks: true, owners: [...artBlockOwners], }),
  ]);
}

module.exports = { tvl, stakingJPEGD, };
