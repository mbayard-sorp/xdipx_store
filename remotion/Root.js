import { jsx as _jsx } from "react/jsx-runtime";
import { Composition } from 'remotion';
import { ProductAd, productAdSchema } from './compositions/ProductAd';
export const RemotionRoot = () => {
    return (_jsx(Composition, { id: "ProductAd", component: ProductAd, durationInFrames: 450, fps: 30, width: 1080, height: 1920, schema: productAdSchema, calculateMetadata: async () => ({
            durationInFrames: 450,
        }), defaultProps: {
            productId: 'preview',
            productName: 'Sample Product',
            brand: 'xdipx',
            imageUrls: [
                'https://via.placeholder.com/1080x1920',
                'https://via.placeholder.com/1080x1920',
            ],
            voAudioFile: '',
            musicAudioFile: undefined,
            narratorScript: 'You didn\'t know you needed this. We did. That\'s kind of our whole thing.',
            reactionText: ['sir this is a wellness site', '...adding to cart'],
            endTagline: 'One deal. One day. No regrets.',
            ctaWord: 'Today.',
            logoUrl: 'https://cdn.sanity.io/images/0nlwk8cf/production/810b2316459824c033570e91758281e33633fb0c-149x60.svg',
            totalDurationInFrames: 450,
        } }));
};
